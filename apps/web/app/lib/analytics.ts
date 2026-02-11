'use client';

import posthog from 'posthog-js';

// ============================================================
// Centralized Analytics — All PostHog custom events in one place
// ============================================================
//
// Every user interaction event is defined here with typed properties.
// Components import and call these helpers instead of using posthog.capture() directly.
// This makes it easy to audit what we track and rename/refactor events.
//
// Note: This file is marked 'use client' to prevent SSR issues with posthog-js
// which accesses window/document internally.

function capture(event: string, properties?: Record<string, unknown>) {
  if (typeof window !== 'undefined' && posthog.__loaded) {
    posthog.capture(event, properties);
  }
}

/**
 * Capture an event and attempt to flush it immediately via sendBeacon.
 * Use this for events fired right before navigation (e.g., link clicks)
 * to prevent events being lost when the page unloads.
 */
function captureBeforeNavigation(event: string, properties?: Record<string, unknown>) {
  if (typeof window !== 'undefined' && posthog.__loaded) {
    posthog.capture(event, properties, { send_instantly: true });
  }
}

// ============================================================
// User Identity
// ============================================================

/** Call once after Clerk auth resolves to link PostHog anonymous ID to real user */
export function identifyUser(userId: string, properties?: {
  email?: string;
  name?: string;
  subscriptionTier?: string;
  signUpSource?: string;
}) {
  if (typeof window !== 'undefined' && posthog.__loaded) {
    posthog.identify(userId, properties);
  }
}

/** Reset identity on sign-out */
export function resetUser() {
  if (typeof window !== 'undefined' && posthog.__loaded) {
    posthog.reset();
  }
}

// ============================================================
// Dashboard Events
// ============================================================

export function trackDashboardViewed(properties: {
  readingTypesCount: number;
}) {
  capture('dashboard_viewed', properties);
}

export function trackReadingCardClicked(properties: {
  readingType: string;
  system: 'bazi' | 'zwds';
  cardPosition: number;
}) {
  captureBeforeNavigation('reading_card_clicked', properties);
}

export function trackSubscriptionCtaClicked(properties: {
  location: 'dashboard_banner' | 'header_link';
}) {
  captureBeforeNavigation('subscription_cta_clicked', properties);
}

// ============================================================
// Birth Data Form Events
// ============================================================

export function trackFormStarted(properties: {
  readingType: string;
}) {
  capture('form_started', properties);
}

export function trackFormFieldFilled(properties: {
  readingType: string;
  fieldName: string;
}) {
  capture('form_field_filled', properties);
}

export function trackFormSubmitted(properties: {
  readingType: string;
  gender: string;
  birthCity: string;
  timezone: string;
}) {
  capture('form_submitted', properties);
}

export function trackFormError(properties: {
  readingType: string;
  errorMessage: string;
}) {
  capture('form_error', properties);
}

export function trackFormAbandoned(properties: {
  readingType: string;
  filledFields: string[];
  timeSpentMs: number;
}) {
  captureBeforeNavigation('form_abandoned', properties);
}

// ============================================================
// Reading / Calculation Events
// ============================================================

export function trackCalculationStarted(properties: {
  readingType: string;
  system: 'bazi' | 'zwds';
}) {
  capture('calculation_started', properties);
}

export function trackCalculationCompleted(properties: {
  readingType: string;
  system: 'bazi' | 'zwds';
  durationMs: number;
  success: boolean;
  errorMessage?: string;
}) {
  capture('calculation_completed', properties);
}

export function trackResultTabSwitched(properties: {
  readingType: string;
  fromTab: string;
  toTab: string;
}) {
  capture('result_tab_switched', properties);
}

export function trackResultStepChanged(properties: {
  readingType: string;
  fromStep: string;
  toStep: string;
}) {
  capture('result_step_changed', properties);
}

export function trackBackButtonClicked(properties: {
  readingType: string;
  currentStep: string;
  destination: 'form' | 'dashboard';
}) {
  capture('back_button_clicked', properties);
}

export function trackRetryClicked(properties: {
  readingType: string;
}) {
  capture('retry_clicked', properties);
}

// ============================================================
// AI Reading Display Events
// ============================================================

export function trackReadingSectionViewed(properties: {
  readingType: string;
  sectionKey: string;
  sectionIndex: number;
  isSubscriber: boolean;
}) {
  capture('reading_section_viewed', properties);
}

export function trackPaywallImpression(properties: {
  readingType: string;
  sectionKey: string;
  sectionIndex: number;
}) {
  capture('paywall_impression', properties);
}

export function trackPaywallCtaClicked(properties: {
  readingType: string;
  sectionKey: string;
}) {
  captureBeforeNavigation('paywall_cta_clicked', properties);
}

export function trackCrossSellClicked(properties: {
  readingType: string;
  targetReadingType: string;
}) {
  captureBeforeNavigation('cross_sell_clicked', properties);
}

export function trackReadingCompleted(properties: {
  readingType: string;
  isSubscriber: boolean;
  sectionsViewed: number;
  totalSections: number;
  timeSpentMs: number;
}) {
  capture('reading_completed', properties);
}

// ============================================================
// Pricing Page Events
// ============================================================

export function trackPricingPageViewed(properties: {
  source: string;
}) {
  capture('pricing_page_viewed', properties);
}

export function trackBillingToggled(properties: {
  newValue: 'monthly' | 'annual';
}) {
  capture('billing_toggled', properties);
}

export function trackPlanCtaClicked(properties: {
  planName: string;
  billingCycle: 'monthly' | 'annual';
  displayPrice: string;
}) {
  captureBeforeNavigation('plan_cta_clicked', properties);
}

// ============================================================
// Auth Events
// ============================================================

export function trackSignUpStarted(properties?: {
  method?: string;
}) {
  capture('sign_up_started', properties);
}

export function trackSignUpCompleted(properties: {
  method: string;
}) {
  capture('sign_up_completed', properties);
}

export function trackSignInCompleted() {
  capture('sign_in_completed');
}

export function trackSignedOut() {
  capture('signed_out');
}

// ============================================================
// Subscription Events
// ============================================================

export function trackFreeReadingUsed(properties: {
  readingType: string;
}) {
  capture('free_reading_used', properties);
}

export function trackSubscriptionStarted(properties: {
  planTier: string;
  billingCycle: 'monthly' | 'annual';
}) {
  capture('subscription_started', properties);
}

// ============================================================
// Scroll / Engagement Events
// ============================================================

export function trackScrollDepth(properties: {
  page: string;
  depth: number; // 25, 50, 75, 100
}) {
  capture('scroll_depth', properties);
}

// ============================================================
// Timing / Performance
// ============================================================

export function trackTimeOnPage(properties: {
  page: string;
  durationMs: number;
}) {
  capture('time_on_page', properties);
}
