import { Upload } from "lucide-react";
import { Modal } from "./Modal.js";
export function UploadDialog({
  busy,
  onClose,
  onUpload,
}: {
  busy: boolean;
  onClose: () => void;
  onUpload: (body: FormData) => void;
}) {
  return (
    <Modal
      title="Add a proposal"
      subtitle="Commit the rubric first. Upload only synthetic documents in this evaluation deployment."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onUpload(new FormData(e.currentTarget));
        }}
      >
        <div className="modal-body">
          <label className="upload-zone">
            <Upload size={30} />
            <strong>Choose a text-based PDF</strong>
            <span>Up to 10 MB · 20 pages · no scan-only files</span>
            <input
              name="file"
              type="file"
              accept="application/pdf,.pdf"
              required
            />
          </label>
          <label className="field">
            <span>Supplier name to mask</span>
            <input name="supplierName" required minLength={2} maxLength={120} />
          </label>
          <label className="field">
            <span>Supplier email</span>
            <input name="supplierEmail" type="email" required />
          </label>
          <label className="field">
            <span>Other identity terms to mask</span>
            <input
              name="identityTerms"
              placeholder="Trading names, product names, people (comma-separated)"
              maxLength={1000}
            />
          </label>
          <label className="checkbox-line">
            <input name="synthetic" type="checkbox" value="true" required />
            This is a synthetic proposal, and I have the right to use it.
          </label>
          <p className="small muted">
            As the uploader, you already know the identity. That exposure is
            recorded; blinding does not erase prior knowledge.
          </p>
        </div>
        <div className="modal-foot">
          <button className="button primary" type="submit" disabled={busy}>
            <Upload size={16} />
            Store proposal privately
          </button>
        </div>
      </form>
    </Modal>
  );
}
