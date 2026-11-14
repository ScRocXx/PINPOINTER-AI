/**
 * Shared types for the database layer.
 */

/** A single indexed document (image or PDF) stored in `document_index`. */
export interface DocumentRecord {
  id?: number;
  title?: string;
  content: string;
  filePath: string;
  type: 'IMAGE' | 'DOCUMENT';
  detection_type: 'TEXT' | 'OBJECT';
  /** When it was indexed (ms). */
  timestamp: number;
  /** When the photo was taken, or the PDF last changed (ms); null when unknown. */
  takenAt?: number | null;
}
