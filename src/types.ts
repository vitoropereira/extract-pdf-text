import { Request } from 'express';

export interface FileRequest extends Request {
  file?: Express.Multer.File;
}

export interface ExtractTextResponse {
  text: string;
}

export interface ErrorResponse {
  error: string;
}

export interface OCROptions {
  density: number;
  saveFilename: string;
  savePath: string;
  format: string;
  width: number;
  height: number;
}