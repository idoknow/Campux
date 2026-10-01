/**
 * QR Code Generator Component
 * 
 * React wrapper component based on QRCode.js that can convert any text to QR code image
 * 
 * Usage example:
 * import QRCodeDataUrl from './components/qrcodedataurl'
 * 
 * function App() {
 *   return <QRCodeDataUrl text="https://example.com" /> // Replace with valid URL
 * }
 */

import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QRCodeDataUrlProps {
  /** 
   * Text content to be encoded as QR code
   * Can be URL, text, contact information, etc.
   * Example: "https://example.com" or "CONTACT:1234567890"
   */
  text: string;

  /**
   * QR code image width (pixels)
   * @default 128
   */
  width?: number;

  /**
   * QR code foreground color (valid CSS color value)
   * @default "#000000" (black)
   */
  color?: string;

  /**
   * QR code background color (valid CSS color value) 
   * @default "#ffffff" (white)
   */
  backgroundColor?: string;

  /**
   * Custom CSS class name
   */
  className?: string;
}

/**
 * QR Code Generator Component
 * @param {QRCodeDataUrlProps} props - Component properties
 */
const QRCodeDataUrl: React.FC<QRCodeDataUrlProps> = ({
  text,
  width = 128,
  color = '#000000',
  backgroundColor = '#ffffff',
  className = '',
}) => {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    const generateQR = async () => {
      try {
        const url = await QRCode.toDataURL(text, {
          width,
          color: {
            dark: color,
            light: backgroundColor,
          },
        });
        setDataUrl(url);
      } catch (err) {
        console.error('Failed to generate QR code:', err);
      }
    };

    generateQR();
  }, [text, width, color, backgroundColor]);

  return (
    <div className={`qr-code-container ${className}`}>
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={`QR Code: ${text}`}
          width={width}
          height={width}
        />
      ) : (
        <div>Generating QR code...</div>
      )}
    </div>
  );
};

export default QRCodeDataUrl;