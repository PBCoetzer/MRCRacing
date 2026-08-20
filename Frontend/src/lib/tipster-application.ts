export type TipsterApplicationStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "changes_requested"
  | "approved"
  | "rejected"
  | "revoked"
  | "withdrawn";

export type TipsterDocumentType =
  | "identity"
  | "proof_of_address"
  | "tax"
  | "bank_confirmation"
  | "other";

export type TipsterContractSection = {
  heading: string;
  body: string;
};

export type TipsterContractVersion = {
  version: string;
  title: string;
  sections: TipsterContractSection[];
  content_hash: string;
  default_commission_rate: number;
  horse_care_share_bps: number;
  effective_at: string;
  is_active: boolean;
};

export type TipsterApplication = {
  id: string;
  user_id: string;
  status: TipsterApplicationStatus;
  legal_name: string | null;
  display_name: string | null;
  phone: string | null;
  experience_summary: string | null;
  biography: string | null;
  contract_version: string | null;
  contract_content_hash: string | null;
  signature_name: string | null;
  acceptance_confirmations: Record<string, boolean> | null;
  contract_accepted_at: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_reason: string | null;
  approved_commission_rate: number | null;
  created_at: string;
  updated_at: string;
};

export type TipsterApplicationDocument = {
  id: string;
  application_id: string;
  user_id: string;
  document_type: TipsterDocumentType;
  storage_path: string;
  original_file_name: string;
  mime_type: "application/pdf" | "image/jpeg" | "image/png";
  size_bytes: number;
  sha256: string;
  created_at: string;
};

export const editableTipsterApplicationStatuses = new Set<TipsterApplicationStatus>([
  "draft",
  "changes_requested",
  "rejected",
]);

export function tipsterApplicationStatusLabel(status: TipsterApplicationStatus) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
