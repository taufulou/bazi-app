/**
 * Everything `ops.mjs` DECIDES and PRINTS, as pure functions (no I/O, no imports).
 *
 * `ops.mjs` is the arm-time AND teardown-time safety check for the load-test
 * mock. It used to decide and print inline, untested; every line the operator
 * reads now comes from `render()` here, and `apps/api/test/ops-report.spec.ts`
 * covers it (PR #74 review). `ops.mjs` only fetches samples and prints.
 *
 * Two things the verdict must get right in BOTH directions, because the script is
 * read at two moments:
 *   - at TEARDOWN only a clean NOT ARMED may pass — every expected replica
 *     answered, none armed, and every one CONFIRMED by a built client whose
 *     base URL is api.anthropic.com (an unbuilt client could still pick up a
 *     bare ANTHROPIC_BASE_URL);
 *   - at ARM time only a full ARMED may pass — every expected replica answered
 *     and armed. A partly armed fleet sends some k6 traffic (and real spend) to
 *     Anthropic and spoils the run.
 * Anything in between is PARTIALLY ARMED, INCONCLUSIVE or NOT CONFIRMED, and
 * says why.
 *
 * Known limits: `replicas` is the server's `REPLICA_COUNT` — if it is set lower
 * than the real fleet (the M2+M8 rule says they move together) coverage is
 * over-trusted. Locally, every process falls back to the same hostname as its
 * replica id, so for a multi-process smoke test set `RAILWAY_REPLICA_ID` per
 * process.
 */

/** AdminController is @Throttle(30/min) per user. */
export const SAMPLES_MAX = 20;

/** Age of a server timestamp, measured on the SERVER's clock (the sample's generatedAt). */
export const ageOn = (sample, ms) => {
  if (ms == null) return '—';
  const ref = Date.parse(sample.generatedAt);
  return `${Math.round(((Number.isFinite(ref) ? ref : Date.now()) - ms) / 1000)}s ago`;
};

/**
 * Plain-language reading of one replica's counters — mirrors the table in
 * apps/api/src/ai/anthropic-rate-limit.ts and the runbook. Keep them in sync.
 *
 * Every started attempt ends as exactly one response or one transport error, so
 * `started − responses − transportErrors` is what is still in flight. Calls that
 * have not answered YET are not failures.
 */
export const interpret = (sample) => {
  const rl = sample.rateLimit ?? {};
  if (!('requestsStarted' in rl)) {
    return ['unknown — this replica runs code older than the #24 counters, so a null cannot be explained'];
  }
  const notes = [];
  const inFlight = Math.max(0, (rl.requestsStarted ?? 0) - (rl.responsesSeen ?? 0) - (rl.transportErrors ?? 0));
  const checkUrl = 'check aiBaseUrlEffective (a stale mock URL looks exactly like this) and AI-CALL outcome:error lines';
  if (rl.requestsStarted === 0) {
    notes.push('no Anthropic call on this replica since it started — null is expected, NOT a bug');
  } else if (rl.responsesSeen === 0 && rl.transportErrors > 0 && rl.transportErrors >= inFlight) {
    // At least as many calls have FAILED as are still waiting: lead with the alarm.
    notes.push(inFlight === 0
      ? `🔴 every call (${rl.transportErrors}) got NO HTTP response — network/DNS failure or timeout; ${checkUrl}`
      : `🔴 ${rl.transportErrors} call(s) got NO HTTP response and none has answered (${inFlight} still in flight) — ` +
        `network/DNS failure or timeout; ${checkUrl}`);
  } else if (rl.responsesSeen === 0 && inFlight > 0) {
    notes.push(`${inFlight} call(s) in flight, nothing back yet — run again in a few seconds`);
    if (rl.transportErrors > 0) {
      notes.push(`⚠️ ${rl.transportErrors} call(s) already got no HTTP response (network error / timeout before headers)`);
    }
  } else if (rl.observedAt != null && rl.outputTokensRemaining == null) {
    notes.push('⚠️ PARTIAL — rate-limit headers arrive but the output-token ones do not parse; rlOutRemaining is blind');
  } else if (rl.observedAt != null) {
    notes.push(`working — reading taken ${ageOn(sample, rl.observedAt)}`);
  } else if (rl.okWithoutHeaders > 0) {
    notes.push('🔴 CAPTURE BROKEN — successful responses arrived without the rate-limit headers');
  } else {
    notes.push(`only error responses so far (last status ${rl.lastResponseStatus ?? '?'}) — not a capture bug`);
  }
  if (rl.transportErrors > 0 && rl.responsesSeen > 0) {
    notes.push(`⚠️ ${rl.transportErrors} call(s) got no HTTP response at all (network error / timeout before headers)`);
  }
  if (rl.okWithoutHeaders > 0 && rl.observedAt != null) {
    notes.push(`⚠️ ${rl.okWithoutHeaders} successful response(s) lacked the headers — the reading may be STALE ` +
      `(reading ${ageOn(sample, rl.observedAt)}, last response ${ageOn(sample, rl.lastResponseAt)})`);
  }
  return notes;
};

const val = (obj, key) => (obj && key in obj ? (obj[key] ?? 'null') : 'unknown (field missing)');

/** Samples grouped by `instance.replicaId`; samples without one are unattributed. */
export function groupByReplica(samples) {
  const withInstance = samples.filter((s) => s.instance && s.instance.replicaId);
  const withoutInstance = samples.filter((s) => !(s.instance && s.instance.replicaId));
  const byReplica = new Map();
  for (const s of withInstance) {
    const e = byReplica.get(s.instance.replicaId) ?? { count: 0, last: s };
    e.count += 1;
    e.last = s; // latest sample from that replica
    byReplica.set(s.instance.replicaId, e);
  }
  return { byReplica, withoutInstance };
}

/**
 * ⚠️ Both signals, because either alone gets it wrong in a dangerous direction.
 *
 * `aiBaseUrlEffective` is null until a client is built on the replica that
 * served this request. Judging on it alone reports NOT ARMED while the variable
 * IS set, which at teardown reads as a false all-clear.
 *
 * `aiBaseUrlOverride` alone misses the other case: the SDK honours a bare
 * ANTHROPIC_BASE_URL of its own accord, which redirects traffic while our
 * override stays null.
 */
export const isArmedSample = (s) =>
  (!!s.aiBaseUrlEffective && !s.aiBaseUrlEffective.includes('api.anthropic.com')) || !!s.aiBaseUrlOverride;

/**
 * The verdict, conservative in both directions (see the file docblock).
 * Precedence: armed → partially_armed → inconclusive → uncertain → not_armed.
 */
export function verdict(samples) {
  const ops = samples[0];
  const expected = ops.replicas ?? 1;
  const { byReplica, withoutInstance } = groupByReplica(samples);
  const reached = byReplica.size;
  const armedReplicas = new Set(
    samples.filter((s) => s.instance && s.instance.replicaId && isArmedSample(s)).map((s) => s.instance.replicaId),
  ).size;
  const armedUnattributed = withoutInstance.filter(isArmedSample).length;
  const unarmedUnattributed = withoutInstance.length - armedUnattributed;
  // Mid rolling deploy a draining old replica and a new one have different ids,
  // so `reached >= expected` can hold while a CURRENT replica never answered.
  const deployments = new Set(samples.map((s) => s.instance && s.instance.deploymentId).filter(Boolean)).size;
  const anyArmed = armedReplicas > 0 || armedUnattributed > 0;
  // CONFIRMED = a sample from that replica shows a built client (an effective
  // base URL). With no override set, an unconfirmed replica is probably fine —
  // but a bare ANTHROPIC_BASE_URL would only show once its client is built.
  const confirmed = new Set(
    samples.filter((s) => s.instance && s.instance.replicaId && s.aiBaseUrlEffective).map((s) => s.instance.replicaId),
  );
  const unconfirmedReplicas = reached - confirmed.size;
  const unconfirmedUnattributed = withoutInstance.filter((s) => !s.aiBaseUrlEffective).length;
  const uncertain = !anyArmed && (unconfirmedReplicas > 0 || unconfirmedUnattributed > 0);
  // Auto-sampling stops after one sample when it has no identity (an API older
  // than #24) — then only an explicit --samples can reach the other replicas.
  const firstUnidentified = !(samples[0].instance && samples[0].instance.replicaId);

  let kind;
  if (anyArmed && reached >= expected && armedReplicas === reached && deployments <= 1 && unarmedUnattributed === 0) {
    kind = 'armed';
  } else if (anyArmed) {
    kind = 'partially_armed';
  } else if (reached < expected || deployments > 1) {
    kind = 'inconclusive';
  } else if (uncertain) {
    kind = 'uncertain';
  } else {
    kind = 'not_armed';
  }
  return {
    kind, expected, reached, armedReplicas, armedUnattributed, unarmedUnattributed, deployments,
    uncertain, unconfirmedReplicas, unconfirmedUnattributed, firstUnidentified,
  };
}

function headline(v) {
  const neverAnswered = v.expected - v.reached;
  const deploy = `a deploy is in progress (${v.deployments} deployments answered) — re-run after it finishes`;
  const rerun = v.firstUnidentified
    ? 'run again with --samples 20 (wait 60s first: 30/min throttle) — the first answer came from code older than #24, which stops auto-sampling'
    : 'wait 60s (30/min throttle) and run again';
  switch (v.kind) {
    case 'armed':
      return `  🟠 ARMED on all ${v.reached} replica(s) reached — AI traffic is going to the MOCK, not to Anthropic.`;
    case 'partially_armed': {
      const why = [];
      if (v.reached - v.armedReplicas > 0) why.push(`${v.reached - v.armedReplicas} reached replica(s) are NOT armed`);
      if (neverAnswered > 0 && v.reached > 0) why.push(`${neverAnswered} of ${v.expected} never answered`);
      if (v.deployments > 1) why.push(deploy);
      if (v.unarmedUnattributed > 0) why.push(`${v.unarmedUnattributed} unattributed sample(s) were NOT armed`);
      const lead = v.reached === 0
        ? `no replica identified itself (expected ${v.expected}), but ${v.armedUnattributed} unattributed sample(s) point at the MOCK`
        : `${v.armedReplicas} of the ${v.reached} replica(s) reached point at the MOCK (expected ${v.expected})` +
          (v.armedUnattributed > 0 ? ` and ${v.armedUnattributed} unattributed sample(s) did` : '');
      return `  🟠 PARTIALLY ARMED — ${lead}${why.length ? `; ${why.join('; ')}` : ''}. ` +
        'Not safe to start a load test, and NOT torn down.';
    }
    case 'inconclusive': {
      const why = [];
      if (neverAnswered > 0) why.push(`${neverAnswered} of ${v.expected} never answered — ${rerun}`);
      if (v.deployments > 1) why.push(deploy);
      const lead = v.reached === 0
        ? `not armed as far as it can tell, but no replica identified itself (expected ${v.expected})`
        : `not armed on the ${v.reached} replica(s) reached, but`;
      return v.reached === 0
        ? `  🟡 INCONCLUSIVE — ${lead}: ${rerun}.`
        : `  🟡 INCONCLUSIVE — ${lead} ${why.join(', and ')}.`;
    }
    case 'uncertain': {
      const parts = [];
      if (v.unconfirmedReplicas > 0) {
        parts.push(`${v.unconfirmedReplicas} of the ${v.reached} replica(s) reached had not built an Anthropic client`);
      }
      if (v.unconfirmedUnattributed > 0) parts.push(`${v.unconfirmedUnattributed} unattributed sample(s) reported none`);
      // One AI call builds a client on ONE replica, and the load balancer picks
      // which — so the advice is per replica, not "make one call".
      return `  🟡 NOT CONFIRMED — no override set, but ${parts.join(' and ')} to confirm against. ` +
        'Make AI calls until each has served one (the load balancer decides which replica does), then run again.';
    }
    default:
      return '  🟢 NOT ARMED — AI traffic is going to the real Anthropic API.';
  }
}

/**
 * Keep sampling? `explicit` (from `--samples N`) takes exactly N. Otherwise AUTO:
 * keep going until every expected replica has answered with an identity, capped
 * at SAMPLES_MAX. An API older than #24 returns no `instance`, so identities can
 * never arrive — stop at one sample (the "older API" block says so).
 */
export function needMoreSamples(samples, { explicit = null } = {}) {
  if (samples.length === 0) return true;
  if (explicit != null) return samples.length < Math.min(SAMPLES_MAX, explicit);
  if (samples.length >= SAMPLES_MAX) return false;
  if (!(samples[0].instance && samples[0].instance.replicaId)) return false;
  return groupByReplica(samples).byReplica.size < (samples[0].replicas ?? 1);
}

/** Every line `ops.mjs` prints after sampling, in order. */
export function render(samples) {
  const out = [];
  // Fleet-wide sections (spend, breaker, replicas) are the same on every replica.
  const ops = samples[0];

  // ⚠️ A MISSING field is not a null field, and conflating them cost three rounds
  // of diagnosis. Production was running code from before `aiBaseUrlEffective`
  // existed, so the response simply had no such key — and this script rendered
  // that identically to "present, but no client built yet". Both readings were
  // honest; both were useless.
  //
  // Same for the override: if the deployed API predates the rename it reads
  // `ANTHROPIC_BASE_URL`, so setting `LOADTEST_ANTHROPIC_BASE_URL` is inert and
  // reports null forever, which looks exactly like not having set it.
  // Checked on EVERY sample — mid rolling-deploy, replicas run different code.
  const missingEffective = samples.some((s) => !('aiBaseUrlEffective' in s));
  const missingOverride = samples.some((s) => !('aiBaseUrlOverride' in s));
  if (missingEffective || missingOverride) {
    out.push('');
    out.push('  ⚠️  THE DEPLOYED API IS OLDER THAN THIS SCRIPT (on at least one replica).');
    out.push(`     /api/admin/ops did not return ${missingEffective ? 'aiBaseUrlEffective' : ''}` +
      `${missingEffective && missingOverride ? ' or ' : ''}${missingOverride ? 'aiBaseUrlOverride' : ''}.`);
    out.push('     That field ships with the load-test switch, so the running code');
    out.push('     probably predates the rename and reads ANTHROPIC_BASE_URL instead.');
    out.push('     Setting LOADTEST_ANTHROPIC_BASE_URL against it does nothing at all.');
    out.push('     Deploy the current branch before trusting anything below.');
  }

  const v = verdict(samples);
  out.push('');
  out.push(headline(v));
  out.push('');
  out.push(`  replicas           : ${ops.replicas}`);
  out.push(`  spend today        : $${ops.spend.dayUsd ?? '?'} / $${ops.spend.dayLimitUsd} (${ops.spend.dayPct ?? '?'}%)`);
  out.push(`  breaker            : ${ops.breaker.trippedOn ?? 'healthy'}`);
  out.push('');

  // ── #24 — per-replica sections: which replica answered, and what it observed ──
  const { byReplica, withoutInstance } = groupByReplica(samples);
  out.push(`  replicas reached   : ${byReplica.size} of ${ops.replicas} identified` +
    ` (in ${samples.length} sample${samples.length === 1 ? '' : 's'})`);
  for (const [id, { count, last }] of byReplica) {
    const rl = last.rateLimit ?? {};
    out.push('');
    out.push(`  ▸ replica ${id}  [${last.instance.replicaIdSource ?? '?'}]  ×${count}`);
    out.push(`      started        : ${last.instance.startedAt ?? '?'}`);
    out.push(`      commit         : ${last.instance.commitSha ?? '(unknown — CLI deploy, or not on Railway)'}`);
    out.push(`      AI base URL    : ${last.aiBaseUrlEffective ?? '(no client built yet on this replica)'}` +
      (last.aiBaseUrlOverride ? `   override: ${last.aiBaseUrlOverride}` : ''));
    if (last.pools) {
      out.push(`      pools.reading  : inFlight=${last.pools.reading?.inFlight} limit=${last.pools.reading?.limit} peak=${last.pools.reading?.peak}` +
        `   interactive: inFlight=${last.pools.interactive?.inFlight} limit=${last.pools.interactive?.limit}`);
    }
    out.push(`      rate limit     : ${val(rl, 'outputTokensRemaining')} output tokens left` +
      (rl.outputTokensReset ? ` (resets ${rl.outputTokensReset})` : ''));
    out.push(`      counters       : started ${val(rl, 'requestsStarted')}   noResponse ${val(rl, 'transportErrors')}` +
      `   responses ${val(rl, 'responsesSeen')}   okWithoutHeaders ${val(rl, 'okWithoutHeaders')}`);
    out.push(`      last response  : ${ageOn(last, rl.lastResponseAt)} (status ${rl.lastResponseStatus ?? '—'})` +
      `   reading taken: ${ageOn(last, rl.observedAt)}`);
    for (const n of interpret(last)) out.push(`      → ${n}`);
  }

  if (withoutInstance.length > 0) {
    out.push('');
    out.push(`  ⚠️  ${withoutInstance.length} sample(s) came from a replica running code OLDER than this script`);
    out.push('     (no `instance`), so they cannot be attributed to a replica. What they reported:');
    for (const s of withoutInstance) {
      out.push(`       AI base URL ${s.aiBaseUrlEffective ?? '(no client yet)'} · rate limit ` +
        `${val(s.rateLimit, 'outputTokensRemaining')} · ${interpret(s)[0]}`);
    }
  }

  if (byReplica.size < (ops.replicas ?? 1)) {
    out.push('');
    out.push(`  ⚠️  INCONCLUSIVE about ${(ops.replicas ?? 1) - byReplica.size} of ${ops.replicas ?? 1} replica(s):`);
    out.push('     they never answered with an identity. The load balancer decides routing, so this');
    out.push('     script cannot force a replica — wait 60s (30/min throttle) and run again.');
    if (v.firstUnidentified) {
      out.push('     The first answer came from code older than #24, which stops auto-sampling — add --samples 20.');
    }
  }
  out.push('');

  // Printed whenever its OWN condition holds — not keyed on the headline, which
  // INCONCLUSIVE can take over while this caveat still applies.
  if (v.uncertain) {
    // Built from the same parts as the NOT CONFIRMED headline, so the two agree.
    const who = [];
    if (v.unconfirmedReplicas > 0) {
      who.push(v.unconfirmedReplicas === v.reached
        ? 'No replica reached had built an Anthropic client'
        : `${v.unconfirmedReplicas} replica(s) reached had not built an Anthropic client`);
    }
    if (v.unconfirmedUnattributed > 0) who.push(`${v.unconfirmedUnattributed} unattributed sample(s) reported none`);
    out.push(`  ⚠️  ${who.join(', and ')}, so for them "not armed" rests on the override`);
    out.push('     alone. Run this again once each has served an AI call, to confirm against a built client.');
    out.push('');
  }
  return out;
}
