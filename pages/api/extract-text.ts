import { NextApiRequest, NextApiResponse } from 'next';
import { createWorker } from 'tesseract.js';
import { fromPath } from 'pdf2pic';
import pdfParse from 'pdf-parse';
import fs from 'fs/promises';
import path from 'path';
import { join } from 'path';

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: '10mb',
  },
};

interface ExtractTextResponse {
  text: string;
}

interface ErrorResponse {
  error: string;
}

// Helper function to parse multipart form data
const parseMultipartForm = async (req: NextApiRequest): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    let chunks: Buffer[] = [];
    
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      resolve(buffer);
    });
    
    req.on('error', reject);
  });
};

// Helper function to extract text using OCR
async function extractTextWithOCR(pdfBuffer: Buffer): Promise<string> {
  try {
    // Create temp directory in /tmp (works in Vercel)
    const tempDir = '/tmp';
    const tempPdfPath = join(tempDir, 'temp.pdf');
    
    // Convert PDF to images
    const options = {
      density: 300,
      saveFilename: "temp",
      savePath: tempDir,
      format: "png",
      width: 2480,
      height: 3508
    };
    
    // Save PDF buffer to temporary file
    await fs.writeFile(tempPdfPath, pdfBuffer);
    
    // Create converter instance
    const converter = fromPath(tempPdfPath, options);
    const pageToConvertAsImage = await converter.bulk(-1, true);

    // Initialize Tesseract worker
    const worker = await createWorker('eng');
    
    // Extract text from the image
    const { data: { text } } = await worker.recognize(pageToConvertAsImage[0].path);
    
    // Cleanup
    await worker.terminate();
    await fs.unlink(tempPdfPath);
    await fs.unlink(pageToConvertAsImage[0].path);

    return text;
  } catch (error) {
    console.error('OCR extraction error:', error);
    throw new Error('Failed to extract text using OCR');
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ExtractTextResponse | ErrorResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data = await parseMultipartForm(req);
    
    // Find the PDF file data in the multipart form data
    const boundary = req.headers['content-type']?.split('boundary=')[1];
    if (!boundary) {
      return res.status(400).json({ error: 'Invalid multipart form data' });
    }

    const parts = data.toString().split(`--${boundary}`);
    let pdfBuffer: Buffer | null = null;

    for (const part of parts) {
      if (part.includes('application/pdf')) {
        const fileContent = part.split('\r\n\r\n')[1]?.split('\r\n--')[0];
        if (fileContent) {
          pdfBuffer = Buffer.from(fileContent, 'binary');
          break;
        }
      }
    }

    if (!pdfBuffer) {
      return res.status(400).json({ error: 'No PDF file provided' });
    }

    // First attempt: Direct PDF text extraction
    let extractedText = '';
    try {
      const result = await pdfParse(pdfBuffer);
      extractedText = result.text.trim();
    } catch (error) {
      console.error('PDF parse error:', error);
    }

    // If direct extraction yields little or no text, try OCR
    if (!extractedText || extractedText.length < 50) {
      try {
        extractedText = await extractTextWithOCR(pdfBuffer);
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
}