-- CreateTable
CREATE TABLE "banner_slides" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "image_url_desktop" TEXT NOT NULL,
    "image_url_mobile" TEXT NOT NULL,
    "link_href" TEXT NOT NULL,
    "alt_text" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banner_slides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "banner_slides_is_active_display_order_idx" ON "banner_slides"("is_active", "display_order");
