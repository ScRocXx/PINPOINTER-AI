// Text reading for the browser preview: always "reads" the sample bill.
import { SAMPLE_SCAN_TEXT } from './sample';
export type DetectionType = 'TEXT' | 'OBJECT' | 'EMPTY';
export interface VisionResult {
  detection_type: DetectionType;
  raw_text: string;
  content: string;
  search_index: string[];
  optimized_status: string;
  embedding: Float32Array | null;
}
/** A uri ending in "#empty" reads as a photo with no words. */
export const analyzeImage = async (uri: string): Promise<VisionResult> => {
  await new Promise(r => setTimeout(r, 60));
  const empty = uri.endsWith('#empty');
  return {
    detection_type: empty ? 'EMPTY' : 'TEXT',
    raw_text: empty ? '' : SAMPLE_SCAN_TEXT,
    content: '',
    search_index: [],
    optimized_status: '',
    embedding: null,
  };
};
