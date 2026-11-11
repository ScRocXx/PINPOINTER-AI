// The phone's photos for the browser preview: drawn sample photos.
import { SAMPLE_PHOTOS } from './sample';

export type PhotoIdentifier = { node: { image: { uri: string }; timestamp: number } };

interface Params {
  first: number;
  after?: string;
  fromTime?: number;
  toTime?: number;
  groupName?: string;
}

export const CameraRoll = {
  getPhotos: async ({ first, after, fromTime, toTime, groupName }: Params) => {
    const all = SAMPLE_PHOTOS.filter(
      p =>
        (fromTime === undefined || p.takenAt > fromTime) &&
        (toTime === undefined || p.takenAt <= toTime) &&
        (!groupName || p.screenshot),
    );
    const start = after ? Number(after) : 0;
    const slice = all.slice(start, start + first);
    const end = start + slice.length;
    return {
      edges: slice.map(p => ({ node: { image: { uri: p.uri }, timestamp: p.takenAt / 1000 } })),
      page_info: { has_next_page: end < all.length, end_cursor: String(end) },
    };
  },
};
