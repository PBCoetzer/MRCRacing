"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCheck2,
  FileText,
  Loader2,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatRaceDateTime } from "@/lib/racing/format";
import {
  editableTipsterApplicationStatuses,
  tipsterApplicationStatusLabel,
  type TipsterApplication,
  type TipsterApplicationDocument,
  type TipsterContractVersion,
  type TipsterDocumentType,
} from "@/lib/tipster-application";
import { createClient } from "@/lib/supabase/client";

const documentSelect = "id,application_id,user_id,document_type,storage_path,original_file_name,mime_type,size_bytes,sha256,created_at";
const supportedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const maximumFileBytes = 10 * 1024 * 1024;

const requiredDocuments: { type: TipsterDocumentType; title: string; description: string }[] = [
  {
    type: "identity",
    title: "Identity document",
    description: "A clear PDF, JPEG, or PNG copy used only for identity and contracting checks.",
  },
  {
    type: "proof_of_address",
    title: "Proof of address",
    description: "A recent document showing your name and residential address.",
  },
];

type Draft = {
  legalName: string;
  displayName: string;
  phone: string;
  experienceSummary: string;
  biography: string;
  signatureName: string;
  confirmAge: boolean;
  confirmAccurate: boolean;
  acceptAgreement: boolean;
};

const emptyDraft: Draft = {
  legalName: "",
  displayName: "",
  phone: "",
  experienceSummary: "",
  biography: "",
  signatureName: "",
  confirmAge: false,
  confirmAccurate: false,
  acceptAgreement: false,
};

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return fallback;
}

function safeFileName(name: string) {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 100);
}

async function fileSha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function TipsterApplicationClient() {
  const [application, setApplication] = useState<TipsterApplication | null>(null);
  const [contract, setContract] = useState<TipsterContractVersion | null>(null);
  const [documents, setDocuments] = useState<TipsterApplicationDocument[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [selectedFiles, setSelectedFiles] = useState<Partial<Record<TipsterDocumentType, File>>>({});
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadApplication = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { data: ensured, error: ensureError } = await supabase.rpc("ensure_my_tipster_application");
      if (ensureError || !ensured) throw ensureError ?? new Error("Application record could not be created.");

      const loadedApplication = ensured as TipsterApplication;
      const [contractResult, documentResult] = await Promise.all([
        supabase
          .from("tipster_contract_versions")
          .select("version,title,sections,content_hash,default_commission_rate,horse_care_share_bps,effective_at,is_active")
          .eq("is_active", true)
          .single(),
        supabase
          .from("tipster_application_documents")
          .select(documentSelect)
          .eq("application_id", loadedApplication.id)
          .order("created_at"),
      ]);

      if (contractResult.error || documentResult.error) {
        throw contractResult.error ?? documentResult.error;
      }

      setApplication(loadedApplication);
      setContract(contractResult.data as TipsterContractVersion);
      setDocuments((documentResult.data ?? []) as TipsterApplicationDocument[]);
      setDraft({
        legalName: loadedApplication.legal_name ?? "",
        displayName: loadedApplication.display_name ?? "",
        phone: loadedApplication.phone ?? "",
        experienceSummary: loadedApplication.experience_summary ?? "",
        biography: loadedApplication.biography ?? "",
        signatureName: loadedApplication.signature_name ?? loadedApplication.legal_name ?? "",
        confirmAge: loadedApplication.acceptance_confirmations?.over18 === true,
        confirmAccurate: loadedApplication.acceptance_confirmations?.informationAccurate === true,
        acceptAgreement: loadedApplication.acceptance_confirmations?.agreementAccepted === true,
      });
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not load your tipster application."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadApplication(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadApplication]);

  const editable = application ? editableTipsterApplicationStatuses.has(application.status) : false;
  const documentByType = useMemo(
    () => new Map(documents.map((document) => [document.document_type, document])),
    [documents],
  );
  const requiredDocumentsReady = requiredDocuments.every((item) => documentByType.has(item.type));

  async function saveDraft() {
    const supabase = createClient();
    if (!supabase || !application) return null;

    setProcessing("save");
    setError("");
    setMessage("");
    try {
      const { data, error: saveError } = await supabase.rpc("save_my_tipster_application", {
        p_legal_name: draft.legalName,
        p_display_name: draft.displayName,
        p_phone: draft.phone,
        p_experience_summary: draft.experienceSummary,
        p_biography: draft.biography,
      });
      if (saveError || !data) throw saveError ?? new Error("The application was not saved.");
      const saved = data as TipsterApplication;
      setApplication(saved);
      setMessage("Application draft saved securely.");
      return saved;
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not save your application."));
      return null;
    } finally {
      setProcessing("");
    }
  }

  async function uploadDocument(documentType: TipsterDocumentType) {
    const supabase = createClient();
    const file = selectedFiles[documentType];
    if (!supabase || !application || !file) return;

    if (!supportedMimeTypes.has(file.type)) {
      setError("Only PDF, JPEG, and PNG documents are accepted.");
      return;
    }
    if (file.size < 1 || file.size > maximumFileBytes) {
      setError("Each document must be between 1 byte and 10 MB.");
      return;
    }
    if (documentByType.has(documentType)) {
      setError("Remove the current document before uploading a replacement.");
      return;
    }

    setProcessing(`upload:${documentType}`);
    setError("");
    setMessage("");
    let storagePath = "";

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw userError ?? new Error("Authentication required.");

      const checksum = await fileSha256(file);
      storagePath = `${user.id}/${application.id}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const { error: storageError } = await supabase.storage
        .from("tipster-applications")
        .upload(storagePath, file, { contentType: file.type, upsert: false });
      if (storageError) throw storageError;

      const { error: documentError } = await supabase
        .from("tipster_application_documents")
        .insert({
          application_id: application.id,
          user_id: user.id,
          document_type: documentType,
          storage_path: storagePath,
          original_file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          sha256: checksum,
        });
      if (documentError) {
        await supabase.storage.from("tipster-applications").remove([storagePath]);
        throw documentError;
      }

      setSelectedFiles((current) => ({ ...current, [documentType]: undefined }));
      setMessage("Supporting document uploaded to the private application vault.");
      await loadApplication();
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not upload the document."));
    } finally {
      setProcessing("");
    }
  }

  async function downloadDocument(document: TipsterApplicationDocument) {
    const supabase = createClient();
    if (!supabase) return;
    setProcessing(`download:${document.id}`);
    setError("");
    try {
      const { data, error: downloadError } = await supabase.storage
        .from("tipster-applications")
        .download(document.storage_path);
      if (downloadError || !data) throw downloadError ?? new Error("Document could not be downloaded.");
      const url = URL.createObjectURL(data);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = document.original_file_name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not download the document."));
    } finally {
      setProcessing("");
    }
  }

  async function removeDocument(document: TipsterApplicationDocument) {
    const supabase = createClient();
    if (!supabase) return;
    setProcessing(`remove:${document.id}`);
    setError("");
    try {
      const { error: storageError } = await supabase.storage
        .from("tipster-applications")
        .remove([document.storage_path]);
      if (storageError) throw storageError;
      const { error: deleteError } = await supabase
        .from("tipster_application_documents")
        .delete()
        .eq("id", document.id);
      if (deleteError) throw deleteError;
      setMessage("Document removed from the private application vault.");
      await loadApplication();
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not remove the document."));
    } finally {
      setProcessing("");
    }
  }

  async function submitApplication() {
    const supabase = createClient();
    if (!supabase || !application || !contract) return;

    setProcessing("submit");
    setError("");
    setMessage("");
    try {
      const { data, error: submitError } = await supabase.rpc("submit_my_tipster_application", {
        p_legal_name: draft.legalName,
        p_display_name: draft.displayName,
        p_phone: draft.phone,
        p_experience_summary: draft.experienceSummary,
        p_biography: draft.biography,
        p_contract_version: contract.version,
        p_contract_content_hash: contract.content_hash,
        p_signature_name: draft.signatureName,
        p_confirm_age: draft.confirmAge,
        p_confirm_accurate: draft.confirmAccurate,
        p_accept_agreement: draft.acceptAgreement,
      });
      if (submitError || !data) throw submitError ?? new Error("Application was not submitted.");
      setApplication(data as TipsterApplication);
      setMessage("Application submitted. MRC administration can now review it.");
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Could not submit your application."));
    } finally {
      setProcessing("");
    }
  }

  if (loading) {
    return <Card><CardContent className="flex min-h-56 items-center justify-center gap-2"><Loader2 className="size-5 animate-spin" />Loading tipster application…</CardContent></Card>;
  }

  return (
    <div className="space-y-6">
      {error ? <Alert variant="destructive"><AlertTriangle className="size-4" /><AlertTitle>Application issue</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {message ? <Alert><CheckCircle2 className="size-4" /><AlertTitle>Application updated</AlertTitle><AlertDescription>{message}</AlertDescription></Alert> : null}

      <Card className="border-brand-cyan/30">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-brand-cyan" />Tipster approval status</CardTitle>
              <CardDescription>Workspace access and public verification are granted together only after approval.</CardDescription>
            </div>
            {application ? <Badge variant={application.status === "approved" ? "default" : "outline"}>{tipsterApplicationStatusLabel(application.status)}</Badge> : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          {application?.status === "approved" ? <p className="text-foreground">Your application is approved. Your Tipster workspace and verified public profile are active.</p> : null}
          {application?.status === "submitted" || application?.status === "under_review" ? <p>Your signed application is locked while MRC reviews it.</p> : null}
          {application?.review_reason ? <p><span className="font-semibold text-foreground">Administrator note:</span> {application.review_reason}</p> : null}
          {application?.submitted_at ? <p>Submitted {formatRaceDateTime(application.submitted_at)}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Applicant details</CardTitle>
          <CardDescription>These details support identity, contracting, and public profile review.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="tipster-legal-name">Full legal name</Label><Input id="tipster-legal-name" disabled={!editable} value={draft.legalName} onChange={(event) => setDraft((current) => ({ ...current, legalName: event.target.value }))} /></div>
          <div><Label htmlFor="tipster-display-name">Public tipster name</Label><Input id="tipster-display-name" disabled={!editable} value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} /></div>
          <div className="sm:col-span-2"><Label htmlFor="tipster-phone">Contact number</Label><Input id="tipster-phone" disabled={!editable} value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} /></div>
          <div className="sm:col-span-2"><Label htmlFor="tipster-experience">Horse-racing experience</Label><Textarea id="tipster-experience" disabled={!editable} rows={6} maxLength={3000} value={draft.experienceSummary} onChange={(event) => setDraft((current) => ({ ...current, experienceSummary: event.target.value }))} /><p className="mt-1 text-xs text-muted-foreground">80–3,000 characters. Explain your racing background, methods, and experience.</p></div>
          <div className="sm:col-span-2"><Label htmlFor="tipster-biography">Proposed public biography</Label><Textarea id="tipster-biography" disabled={!editable} rows={4} maxLength={1500} value={draft.biography} onChange={(event) => setDraft((current) => ({ ...current, biography: event.target.value }))} /><p className="mt-1 text-xs text-muted-foreground">40–1,500 characters. Do not include private contact or banking details.</p></div>
          {editable ? <Button type="button" disabled={processing === "save"} onClick={() => void saveDraft()}><Save className="size-4" />Save draft</Button> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileCheck2 className="size-5 text-brand-gold" />Private supporting documents</CardTitle>
          <CardDescription>Only you and authorised MRC administrators can download these files. PDF, JPEG, or PNG only; maximum 10 MB each.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          {requiredDocuments.map((item) => {
            const document = documentByType.get(item.type);
            return (
              <div key={item.type} className="rounded-lg border bg-background/45 p-4">
                <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-white">{item.title}</p><p className="mt-1 text-sm text-muted-foreground">{item.description}</p></div>{document ? <Badge>Uploaded</Badge> : <Badge variant="outline">Required</Badge>}</div>
                {document ? (
                  <div className="mt-4 space-y-3"><p className="truncate text-sm">{document.original_file_name}</p><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={processing === `download:${document.id}`} onClick={() => void downloadDocument(document)}><Download className="size-4" />Download</Button>{editable ? <Button type="button" size="sm" variant="destructive" disabled={processing === `remove:${document.id}`} onClick={() => void removeDocument(document)}><Trash2 className="size-4" />Remove</Button> : null}</div></div>
                ) : editable ? (
                  <div className="mt-4 space-y-3"><Input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setSelectedFiles((current) => ({ ...current, [item.type]: event.target.files?.[0] }))} /><Button type="button" size="sm" disabled={!selectedFiles[item.type] || processing === `upload:${item.type}`} onClick={() => void uploadDocument(item.type)}>{processing === `upload:${item.type}` ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}Upload securely</Button></div>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {contract ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><FileText className="size-5 text-brand-cyan" />{contract.title}</CardTitle><CardDescription>Version {contract.version} · content hash {contract.content_hash.slice(0, 12)}…</CardDescription></div><Badge variant="outline">Electronic agreement</Badge></div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-lg border border-brand-gold/25 bg-brand-purple-deep/35 p-4 text-sm"><p><span className="font-semibold text-white">Standard platform commission:</span> {Number(contract.default_commission_rate).toLocaleString("en-ZA")}% of qualifying Purchased Credits.</p><p className="mt-2"><span className="font-semibold text-white">Horse-care contribution:</span> {(contract.horse_care_share_bps / 100).toLocaleString("en-ZA")}% of MRC&apos;s qualifying platform commission, not an extra tipster deduction.</p></div>
            <div className="max-h-[34rem] space-y-5 overflow-y-auto rounded-lg border p-5">
              {contract.sections.map((section) => <section key={section.heading}><h3 className="font-semibold text-white">{section.heading}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{section.body}</p></section>)}
            </div>
            {editable ? (
              <div className="space-y-4">
                <div><Label htmlFor="tipster-signature">Electronic signature — type your full legal name</Label><Input id="tipster-signature" value={draft.signatureName} onChange={(event) => setDraft((current) => ({ ...current, signatureName: event.target.value }))} /></div>
                {[
                  ["confirmAge", "I confirm that I am at least 18 years old."],
                  ["confirmAccurate", "I confirm that my application and uploaded documents are accurate and belong to me."],
                  ["acceptAgreement", "I accept this exact agreement version, the website Terms, Privacy Policy, Refund Policy, and Cancellation Policy."],
                ].map(([field, label]) => <label key={field} className="flex items-start gap-3 rounded-lg border p-3 text-sm"><input className="mt-0.5 size-4 accent-[var(--color-brand-gold)]" type="checkbox" checked={Boolean(draft[field as keyof Draft])} onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.checked }))} /><span>{label}</span></label>)}
                <p className="text-xs text-muted-foreground">This electronic record identifies your account, timestamp, contract version, and content hash. MRC should have the agreement wording reviewed by a South African attorney before accepting external applicants.</p>
                <Button type="button" disabled={!requiredDocumentsReady || processing === "submit"} onClick={() => void submitApplication()}>{processing === "submit" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}Sign and submit application</Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
