import multer from 'multer';
import { env } from '../config/env';

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 4, fields: 20 } });
