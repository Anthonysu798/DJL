CREATE TABLE "commerce_supplier_payment_documents" (
  "id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  "operation_id" uuid NOT NULL,
  "supplier_id" uuid NOT NULL,
  "amount_cents" bigint NOT NULL,
  "currency" text NOT NULL DEFAULT 'CAD',
  "mode" text NOT NULL DEFAULT 'test',
  "source" text NOT NULL DEFAULT 'unverified_manual_test_document',
  "reference" text NOT NULL,
  "evidence_reference" text NOT NULL,
  "reason" text NOT NULL,
  "recorded_by" uuid NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "commerce_supplier_payment_documents_operation_id_unique" UNIQUE ("operation_id"),
  CONSTRAINT "commerce_supplier_payment_documents_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "commerce_suppliers"("id"),
  CONSTRAINT "commerce_supplier_payment_document_amount" CHECK (amount_cents BETWEEN 1 AND 9007199254740991),
  CONSTRAINT "commerce_supplier_payment_document_scope" CHECK (currency='CAD' AND mode='test' AND source='unverified_manual_test_document'),
  CONSTRAINT "commerce_supplier_payment_document_text" CHECK (reference=btrim(reference) AND char_length(reference) BETWEEN 1 AND 150 AND evidence_reference=btrim(evidence_reference) AND char_length(evidence_reference) BETWEEN 1 AND 500 AND reason=btrim(reason) AND char_length(reason) BETWEEN 1 AND 500)
);--> statement-breakpoint
CREATE INDEX "commerce_supplier_payment_documents_supplier_idx" ON "commerce_supplier_payment_documents" ("supplier_id","recorded_at","id");--> statement-breakpoint
CREATE INDEX "commerce_supplier_payment_documents_reference_idx" ON "commerce_supplier_payment_documents" ("reference");--> statement-breakpoint
CREATE TRIGGER commerce_supplier_payment_documents_immutable BEFORE UPDATE OR DELETE ON commerce_supplier_payment_documents FOR EACH ROW EXECUTE FUNCTION commerce_append_only();--> statement-breakpoint
CREATE TRIGGER commerce_supplier_payment_documents_no_truncate BEFORE TRUNCATE ON commerce_supplier_payment_documents FOR EACH STATEMENT EXECUTE FUNCTION commerce_append_only();
