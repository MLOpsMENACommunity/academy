-- Star ratings on reviews (testimonials): 1 to 5, optional. Old rows keep a null rating.
-- A review may now be stars only; its words are then stored as '' (body stays NOT NULL).
ALTER TABLE "Testimonial" ADD COLUMN "rating" INTEGER;
ALTER TABLE "Testimonial" ADD CONSTRAINT "Testimonial_rating_check" CHECK ("rating" IS NULL OR ("rating" >= 1 AND "rating" <= 5));
