import { Linking, NativeModules } from 'react-native';
import { openPdf } from '../OpenPdf';

const openURL = jest.spyOn(Linking, 'openURL').mockImplementation(async () => true);
const native = NativeModules.StorageModule as { openPDF?: jest.Mock };
const realOpenPDF = native.openPDF;

beforeEach(() => {
  jest.clearAllMocks();
  native.openPDF = realOpenPDF;
});

afterAll(() => {
  native.openPDF = realOpenPDF;
});

describe('openPdf', () => {
  it('hands the plain path to the native module', async () => {
    await openPdf('file:///storage/emulated/0/Download/bill.pdf');
    expect(native.openPDF).toHaveBeenCalledWith('/storage/emulated/0/Download/bill.pdf');
    expect(openURL).not.toHaveBeenCalled();
  });

  it('without the module opens the file as a link, adding file:// to a bare path', async () => {
    native.openPDF = undefined;
    await openPdf('/storage/emulated/0/Download/bill.pdf');
    expect(openURL).toHaveBeenCalledWith('file:///storage/emulated/0/Download/bill.pdf');
    await openPdf('file:///docs/a.pdf');
    expect(openURL).toHaveBeenLastCalledWith('file:///docs/a.pdf');
    await openPdf('content://media/external/file/7');
    expect(openURL).toHaveBeenLastCalledWith('content://media/external/file/7');
  });

  it('rejects when nothing can open the file, so the caller can say so', async () => {
    native.openPDF = undefined;
    openURL.mockRejectedValueOnce(new Error('No Activity found'));
    await expect(openPdf('file:///docs/a.pdf')).rejects.toThrow('No Activity found');
  });
});
