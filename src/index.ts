import express, { Response, NextFunction } from 'express';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { createWorker } from 'tesseract.js';
import { fromPath } from 'pdf2pic';
import fs from 'fs/promises';
import path from 'path';
import { FileRequest, ExtractTextResponse, ErrorResponse, OCROptions } from './types';

const app = express();
const port = process.env.PORT || 3000;

// Configure multer for PDF file uploads
const upload = multer({
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Please upload a PDF file.'));
    }
  },
});

// Helper function to extract text using OCR
async function extractTextWithOCR(pdfBuffer: Buffer): Promise<string> {
  try {
    // Convert PDF to images
    const options: OCROptions = {
      density: 300,
      saveFilename: "temp",
      savePath: "./temp",
      format: "png",
      width: 2480,
      height: 3508
    };
    
    // Save PDF buffer to temporary file
    const tempPdfPath = './temp/temp.pdf';
    await fs.writeFile(tempPdfPath, pdfBuffer);
    
    const convert = fromPath(tempPdfPath, options);
    const pageToConvertAsImage = await convert.convert();

    // Initialize Tesseract worker
    const worker = await createWorker('eng');
    
    // Extract text from the image
    const { data: { text } } = await worker.recognize(pageToConvertAsImage.path);
    
    // Cleanup
    await worker.terminate();
    await fs.unlink(tempPdfPath);
    await fs.unlink(pageToConvertAsImage.path);

    return text;
  } catch (error) {
    console.error('OCR extraction error:', error);
    throw new Error('Failed to extract text using OCR');
  }
}

// Main endpoint for text extraction
app.post('/api/extract-text', 
  upload.single('pdf'), 
  async (req: FileRequest, res: Response<ExtractTextResponse | ErrorResponse>) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No PDF file provided' });
      }

      // First attempt: Direct PDF text extraction
      let extractedText = '';
      try {
        const result = await pdfParse(req.file.buffer);
        extractedText = result.text.trim();
      } catch (error) {
        console.error('PDF parse error:', error);
      }

      // If direct extraction yields little or no text, try OCR
      if (!extractedText || extractedText.length < 50) {
        try {
          extractedText = await extractTextWithOCR(req.file.buffer);
        } catch (ocrError) {
          console.error('OCR error:', ocrError);
          if (!extractedText) {
            return res.status(500).json({ 
              error: 'Failed to extract text from PDF using both direct extraction and OCR' 
            });
          }
        }
      }

      res.json({ text: extractedText });
    } catch (error) {
      console.error('Processing error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'An error occurred while processing the PDF'
      });
    }
});

// Error handling middleware
app.use((error: Error, _req: FileRequest, res: Response<ErrorResponse>, _next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large. Maximum size is 10MB.' });
    }
  }
  res.status(500).json({ error: error.message });
});

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, '../temp');
fs.mkdir(tempDir, { recursive: true })
  .catch(console.error);

app.listen(port, () => {
  console.log(`PDF Text Extraction API running on port ${port}`);
});