import { CorrelationMiddleware } from './correlation.middleware';

const buildReq = (headers: Record<string, string | string[]> = {}) => {
  const req: { headers: Record<string, string | string[]>; correlationId?: string } = { headers };
  return req;
};
const buildRes = () => {
  const res: { setHeader: jest.Mock; headers: Record<string, string> } = {
    headers: {},
    setHeader: jest.fn(function (k: string, v: string) {
      res.headers[k] = v;
    }),
  };
  return res;
};

describe('CorrelationMiddleware', () => {
  it('uses an inbound X-Request-Id when present', () => {
    const mw = new CorrelationMiddleware();
    const req = buildReq({ 'x-request-id': 'abc-123' });
    const res = buildRes();
    const next = jest.fn();
    mw.use(req as any, res as any, next);
    expect(req.correlationId).toBe('abc-123');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'abc-123');
    expect(next).toHaveBeenCalled();
  });

  it('generates a new id when none is provided', () => {
    const mw = new CorrelationMiddleware();
    const req = buildReq();
    const res = buildRes();
    const next = jest.fn();
    mw.use(req as any, res as any, next);
    expect(req.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', expect.any(String));
  });
});
