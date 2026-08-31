import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { db } from '../db';

interface JwtPayload {
  userId: string;
  email: string;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Authentication required. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;

    const user = await db.getOne(
      'SELECT id, email, full_name as "fullName", is_email_verified as "isEmailVerified" FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (!user) {
      return res.status(401).json({ success: false, error: 'User session invalid or user not found.' });
    }

    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName || user.full_name,
    };

    next();
  } catch (err: any) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token.' });
  }
}
