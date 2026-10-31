// Adds `user` to Express's Request type, set by the requireAuth middleware.
declare global {
  namespace Express {
    interface Request {
      user?: { id: string };
    }
  }
}

export {};
