import { Request, Response, NextFunction } from 'express';

const requestCounts = new Map<string, { count: number; resetTime: number }>();

export function rateLimit(options: { windowMs: number; maxRequests: number }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';
    const key = `${ip}:${req.path}`;
    const now = Date.now();

    const record = requestCounts.get(key);

    if (!record || now > record.resetTime) {
      requestCounts.set(key, { count: 1, resetTime: now + options.windowMs });
      return next();
    }

    if (record.count >= options.maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please slow down and try again shortly.',
      });
    }

    record.count++;
    next();
  };
}
