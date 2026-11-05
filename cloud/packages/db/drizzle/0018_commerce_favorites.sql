CREATE TABLE "commerce_favorites" (
  "user_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "commerce_favorites_user_id_product_id_pk" PRIMARY KEY ("user_id", "product_id"),
  CONSTRAINT "commerce_favorites_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE,
  CONSTRAINT "commerce_favorites_product_id_commerce_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "commerce_products"("id") ON DELETE CASCADE
);
