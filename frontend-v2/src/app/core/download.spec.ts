import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { downloadFile, fileNameFrom } from './download';

describe('downloadFile', () => {
  it('pide el archivo por HttpClient (así viaja el token) en vez de un enlace directo que daba 401', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpClient);
    const httpMock = TestBed.inject(HttpTestingController);
    const clicked: string[] = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    };
    try {
      const pending = downloadFile(http, '/api/audit-logs/export', 'auditoria.csv');
      const req = httpMock.expectOne('/api/audit-logs/export');
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['a,b']), { headers: { 'Content-Disposition': 'attachment; filename="audit-2026-09.csv"' } });
      await pending;
      expect(clicked).toEqual(['audit-2026-09.csv']);
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }
  });
});

describe('fileNameFrom', () => {
  it('lee filename simple, RFC 5987 y ausencia', () => {
    expect(fileNameFrom('attachment; filename="backup.enc"')).toBe('backup.enc');
    expect(fileNameFrom("attachment; filename*=UTF-8''bit%C3%A1cora.csv")).toBe('bitácora.csv');
    expect(fileNameFrom(null)).toBeNull();
  });
});
