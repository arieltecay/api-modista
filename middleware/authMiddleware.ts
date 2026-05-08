import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Extender la interfaz Request para incluir user
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        role: 'admin' | 'user';
      };
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET no está definido en las variables de entorno');
}

/**
 * Middleware para autenticar tokens JWT.
 * Falla si no hay token o si este no es válido.
 */
export const authenticateToken = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  // Caso 1: No hay token - Error 401
  if (!authHeader) {
    res.status(401).json({ message: 'Token de acceso requerido. Por favor, inicie sesión.' });
    return;
  }

  // Caso 2: Intento de autenticación - Validar formato
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    res.status(401).json({ message: 'Formato de autorización inválido. Use "Bearer [token]"' });
    return;
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email: string;
      role: 'admin' | 'user';
    };

    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ message: 'El token ha expirado. Por favor, inicie sesión de nuevo.' });
      return;
    }
    
    res.status(403).json({ message: 'Token de acceso inválido o corrupto.' });
  }
};

interface TokenPayload {
  userId: string;
  email: string;
  role: 'admin' | 'user';
}

/**
 * Middleware para autenticar tokens JWT opcionalmente.
 * No falla si no hay token (acceso como invitado), pero si se provee un token,
 * este debe ser válido; de lo contrario, devuelve un error específico.
 */
export const optionalAuthenticateToken = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    req.user = undefined;
    return next();
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    req.user = undefined;
    return next();
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    req.user = decoded;
    next();
  } catch (error) {
    req.user = undefined;
    next();
  }
};

/**
 * Middleware para verificar rol de administrador
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ message: 'Usuario no autenticado' });
    return;
  }

  if (req.user.role !== 'admin') {
    res.status(403).json({ message: 'Acceso denegado. Se requieren permisos de administrador' });
    return;
  }

  next();
};