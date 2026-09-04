import { describe, it, expect } from 'vitest';
import { detectDOMPII, luhnCheck } from '../extension/content/pii-detector-dom';
import { DOMSnapshot } from '../extension/content/dom-reader';

describe('PIIDetectorDOM Unit Tests', () => {
  it('correctly validates credit card numbers using Luhn checksum', () => {
    expect(luhnCheck('4532015012345671')).toBe(true);
    expect(luhnCheck('4532 0150 1234 5671')).toBe(true);
    expect(luhnCheck('4532015012345675')).toBe(false); // Invalid checksum (ends in 5 instead of 1)
  });

  it('detects all known PII on a sample signup form snapshot', () => {
    const fixtureSnapshot: DOMSnapshot = {
      url: 'http://localhost:3001/checkout-form.html',
      title: 'Checkout & Registration',
      timestamp: Date.now(),
      elements: [
        {
          id: 'field-name',
          tag: 'input',
          type: 'text',
          name: 'fullname',
          autocomplete: 'name',
          placeholder: 'Full Name',
          text: 'Ankita Sharma',
          value: 'Ankita Sharma',
          selector: '#field-name',
          bbox: { x: 100, y: 150, width: 220, height: 35 },
          isInteractive: true
        },
        {
          id: 'field-email',
          tag: 'input',
          type: 'email',
          name: 'email',
          autocomplete: 'email',
          placeholder: 'Email Address',
          text: 'ankita@gmail.com',
          value: 'ankita@gmail.com',
          selector: '#field-email',
          bbox: { x: 100, y: 200, width: 220, height: 35 },
          isInteractive: true
        },
        {
          id: 'field-phone',
          tag: 'input',
          type: 'tel',
          name: 'phone',
          autocomplete: 'tel',
          placeholder: 'Mobile Number',
          text: '+91 98765 43210',
          value: '+91 98765 43210',
          selector: '#field-phone',
          bbox: { x: 100, y: 250, width: 220, height: 35 },
          isInteractive: true
        },
        {
          id: 'field-card',
          tag: 'input',
          type: 'text',
          name: 'ccnumber',
          autocomplete: 'cc-number',
          placeholder: 'Card Number',
          text: '4532 0150 1234 5671',
          value: '4532 0150 1234 5671',
          selector: '#field-card',
          bbox: { x: 100, y: 300, width: 220, height: 35 },
          isInteractive: true
        },
        {
          id: 'btn-submit',
          tag: 'button',
          text: 'Submit Order',
          selector: '#btn-submit',
          bbox: { x: 100, y: 360, width: 140, height: 40 },
          isInteractive: true
        }
      ]
    };

    const detections = detectDOMPII(fixtureSnapshot);

    expect(detections.length).toBe(4);

    const types = detections.map(d => d.type);
    expect(types).toContain('NAME');
    expect(types).toContain('EMAIL');
    expect(types).toContain('PHONE');
    expect(types).toContain('CARD');

    const emailDetection = detections.find(d => d.type === 'EMAIL');
    expect(emailDetection?.originalValue).toBe('ankita@gmail.com');
    expect(emailDetection?.surrogateValue).toContain('@example.com');

    const cardDetection = detections.find(d => d.type === 'CARD');
    expect(cardDetection?.originalValue).toBe('4532 0150 1234 5671');
    expect(cardDetection?.surrogateValue).toBe('**** **** **** 1234');
  });

  it('detects AVATAR and text PII correctly in PIIDetector core engine', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PIIDetector = require('../pii-detector');

    const sampleWords = [
      { text: '[PHOTO_AVATAR]', isAvatar: true, confidence: 99, bbox: { x: 50, y: 50, width: 64, height: 64 } },
      { text: 'Google', confidence: 95, bbox: { x: 120, y: 50, width: 45, height: 16 } },
      { text: 'Account:', confidence: 95, bbox: { x: 170, y: 50, width: 55, height: 16 } },
      { text: 'john.doe@gmail.com', confidence: 98, bbox: { x: 230, y: 50, width: 140, height: 16 } },
      { text: 'Copyright', confidence: 95, bbox: { x: 50, y: 150, width: 60, height: 16 } },
      { text: '2026', confidence: 95, bbox: { x: 115, y: 150, width: 35, height: 16 } },
      { text: 'Call', confidence: 95, bbox: { x: 50, y: 200, width: 30, height: 16 } },
      { text: '+91', confidence: 95, bbox: { x: 85, y: 200, width: 25, height: 16 } },
      { text: '9876543210', confidence: 98, bbox: { x: 115, y: 200, width: 80, height: 16 } }
    ];

    const result = PIIDetector.detectPII(sampleWords);

    expect(result.matches.length).toBe(3);
    const types = result.matches.map((m: any) => m.type);
    expect(types).toContain('AVATAR');
    expect(types).toContain('EMAIL');
    expect(types).toContain('PHONE');
    expect(types).not.toContain('OTP'); // 2026 should NOT be flagged as OTP

    const avatarMatch = result.matches.find((m: any) => m.type === 'AVATAR');
    expect(avatarMatch?.bbox).toEqual({ x: 50, y: 50, width: 64, height: 64 });

    const emailMatch = result.matches.find((m: any) => m.type === 'EMAIL');
    expect(emailMatch?.matchedText).toBe('john.doe@gmail.com');
  });

  it('refines large photo bounding boxes to pinpoint the face region', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PIIDetector = require('../pii-detector');

    const matches = [
      {
        type: 'AVATAR',
        bbox: { x: 100, y: 100, width: 600, height: 450 },
        confidence: 98.0
      }
    ];

    const dummyImg = { width: 1280, height: 800 };
    const refined = PIIDetector.refineFaceBoundingBoxes(matches, dummyImg, 1280, 800);

    expect(refined.length).toBe(1);
    // Face bbox should be much smaller than the 600x450 photo container
    expect(refined[0].bbox.width).toBeLessThan(600);
    expect(refined[0].bbox.height).toBeLessThan(450);
  });

  it('detects Unicode small-caps, superscript, and subscript obfuscated PII', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PIIDetector = require('../pii-detector');

    // Test unwrapper
    expect(PIIDetector.unwrapUnicodeSmallText('ᵗˢʳᶦⁿᵃᵗʰ@ᵗᵒᵐᵃᵗᵒ.ᶜᵒᵐ')).toBe('tsrinath@tomato.com');
    expect(PIIDetector.unwrapUnicodeSmallText('ᴛsʀɪɴᴀᴛʜ@ᴛᴏᵐᴀᴛᴏ.ᴄᴏᴍ')).toBe('tsrinath@tomato.com');
    expect(PIIDetector.unwrapUnicodeSmallText('⁺⁹¹ ⁹⁸⁷⁶⁵ ⁴³²¹⁰')).toBe('+91 98765 43210');

    // Test detector on stylized words
    const stylizedWords = [
      { text: 'Email:', confidence: 95, bbox: { x: 50, y: 50, width: 50, height: 16 } },
      { text: 'ᵗˢʳᶦⁿᵃᵗʰ@ᵗᵒᵐᵃᵗᵒ.ᶜᵒᵐ', confidence: 98, bbox: { x: 110, y: 50, width: 120, height: 16 } },
      { text: 'Phone:', confidence: 95, bbox: { x: 50, y: 100, width: 50, height: 16 } },
      { text: '⁺⁹¹', confidence: 95, bbox: { x: 110, y: 100, width: 25, height: 16 } },
      { text: '⁹⁸⁷⁶⁵⁴³²¹⁰', confidence: 98, bbox: { x: 140, y: 100, width: 80, height: 16 } }
    ];

    const result = PIIDetector.detectPII(stylizedWords);
    expect(result.matches.length).toBe(2);

    const emailMatch = result.matches.find((m: any) => m.type === 'EMAIL');
    expect(emailMatch).toBeDefined();

    const phoneMatch = result.matches.find((m: any) => m.type === 'PHONE');
    expect(phoneMatch).toBeDefined();
  });

  it('accurately detects Aadhaar numbers, DOB, and rejects IFSC false positives on regular text', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PIIDetector = require('../pii-detector');

    // Verhoeff Aadhaar validation
    expect(PIIDetector.validateAadhaar('7730 0889 2163')).toBe(true);
    expect(PIIDetector.validateAadhaar('773008892163')).toBe(true);
    expect(PIIDetector.validateAadhaar('123456789012')).toBe(false);

    // Test words from Aadhaar sample document
    const aadhaarDocWords = [
      { text: 'The', confidence: 95, bbox: { x: 50, y: 50, width: 30, height: 16 } },
      { text: 'document', confidence: 95, bbox: { x: 85, y: 50, width: 70, height: 16 } },
      { text: 'Authority', confidence: 95, bbox: { x: 50, y: 100, width: 65, height: 16 } },
      { text: 'of', confidence: 95, bbox: { x: 120, y: 100, width: 20, height: 16 } },
      { text: 'DOB:', confidence: 95, bbox: { x: 50, y: 150, width: 40, height: 16 } },
      { text: '30/05/1995', confidence: 98, bbox: { x: 95, y: 150, width: 85, height: 16 } },
      { text: '7730', confidence: 98, bbox: { x: 50, y: 200, width: 40, height: 16 } },
      { text: '0889', confidence: 98, bbox: { x: 95, y: 200, width: 40, height: 16 } },
      { text: '2163', confidence: 98, bbox: { x: 140, y: 200, width: 40, height: 16 } },
      { text: 'IFSC:', confidence: 95, bbox: { x: 50, y: 250, width: 40, height: 16 } },
      { text: 'SBIN0001234', confidence: 98, bbox: { x: 95, y: 250, width: 100, height: 16 } }
    ];

    const result = PIIDetector.detectPII(aadhaarDocWords);
    
    // Should NOT have false IFSC matches for "The document" or "Authority of"
    const ifscMatches = result.matches.filter((m: any) => m.type === 'IFSC');
    expect(ifscMatches.length).toBe(1);
    expect(ifscMatches[0].matchedText).toBe('SBIN0001234');

    // Should detect DOB: 30/05/1995
    const dobMatch = result.matches.find((m: any) => m.type === 'DOB');
    expect(dobMatch).toBeDefined();
    expect(dobMatch.matchedText).toBe('30/05/1995');

    // Should detect Aadhaar: 7730 0889 2163
    const aadhaarMatch = result.matches.find((m: any) => m.type === 'AADHAAR');
    expect(aadhaarMatch).toBeDefined();
    expect(aadhaarMatch.matchedText).toBe('7730 0889 2163');
  });

  it('does not falsely detect PII on login screens, version strings, or game client UI', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PIIDetector = require('../pii-detector');

    const loginUiWords = [
      { text: 'RIOT', confidence: 99, bbox: { x: 50, y: 50, width: 40, height: 16 } },
      { text: 'GAMES', confidence: 99, bbox: { x: 95, y: 50, width: 50, height: 16 } },
      { text: 'Sign-in', confidence: 99, bbox: { x: 50, y: 100, width: 60, height: 16 } },
      { text: 'QR', confidence: 99, bbox: { x: 120, y: 100, width: 25, height: 16 } },
      { text: 'Code', confidence: 99, bbox: { x: 150, y: 100, width: 35, height: 16 } },
      { text: 'USERNAME', confidence: 99, bbox: { x: 50, y: 150, width: 70, height: 16 } },
      { text: 'PASSWORD', confidence: 99, bbox: { x: 50, y: 200, width: 70, height: 16 } },
      { text: 'Stay', confidence: 99, bbox: { x: 50, y: 250, width: 30, height: 16 } },
      { text: 'signed', confidence: 99, bbox: { x: 85, y: 250, width: 45, height: 16 } },
      { text: 'in', confidence: 99, bbox: { x: 135, y: 250, width: 15, height: 16 } },
      { text: 'CAN\'T', confidence: 99, bbox: { x: 50, y: 300, width: 40, height: 16 } },
      { text: 'SIGN', confidence: 99, bbox: { x: 95, y: 300, width: 35, height: 16 } },
      { text: 'IN?', confidence: 99, bbox: { x: 135, y: 300, width: 25, height: 16 } },
      { text: 'v138.0.1', confidence: 99, bbox: { x: 200, y: 300, width: 55, height: 16 } },
      { text: 'PROTECTED', confidence: 99, bbox: { x: 50, y: 350, width: 75, height: 16 } },
      { text: 'BY', confidence: 99, bbox: { x: 130, y: 350, width: 20, height: 16 } },
      { text: 'HCAPTCHA', confidence: 99, bbox: { x: 155, y: 350, width: 70, height: 16 } }
    ];

    const result = PIIDetector.detectPII(loginUiWords);
    expect(result.matches.length).toBe(0);
  });

  it('redacts sensitive password and credential input fields', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PIIDetector = require('../pii-detector');

    const formWords = [
      { text: 'USERNAME:', confidence: 99, bbox: { x: 50, y: 50, width: 60, height: 16 } },
      { text: 'alex_user', confidence: 99, bbox: { x: 120, y: 50, width: 60, height: 16 } },
      { text: 'PASSWORD:', confidence: 99, bbox: { x: 50, y: 100, width: 60, height: 16 } },
      { text: 'SRINATHHH', isPassword: true, confidence: 99, bbox: { x: 120, y: 100, width: 70, height: 16 } }
    ];

    const result = PIIDetector.detectPII(formWords);
    expect(result.matches.length).toBe(1);

    const pwdMatch = result.matches.find((m: any) => m.type === 'PASSWORD');
    expect(pwdMatch).toBeDefined();
    expect(pwdMatch.matchedText).toBe('SRINATHHH');
  });

  it('detects wide-gap embossed credit cards, mock cards, and expiry dates from physical card images', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PIIDetector = require('../pii-detector');

    // Words modeled directly from Barclaycard mock card image with 80-100px gaps between 4-digit blocks
    const cardWords = [
      { text: 'BARCLAYCARD', confidence: 98, bbox: { x: 50, y: 50, width: 140, height: 24 } },
      { text: 'BUSINESS', confidence: 98, bbox: { x: 200, y: 50, width: 100, height: 24 } },
      // Card number with wide gaps: (180 - (50+80) = 50px), (310 - (180+80) = 50px), (440 - (310+80) = 50px)
      { text: '5476', confidence: 99, bbox: { x: 50, y: 150, width: 80, height: 32 } },
      { text: '7678', confidence: 99, bbox: { x: 210, y: 150, width: 80, height: 32 } },
      { text: '9876', confidence: 99, bbox: { x: 370, y: 150, width: 80, height: 32 } },
      { text: '5432', confidence: 99, bbox: { x: 530, y: 150, width: 80, height: 32 } },
      // Expiry line
      { text: '01/14', confidence: 95, bbox: { x: 50, y: 220, width: 50, height: 20 } },
      { text: 'VALID', confidence: 95, bbox: { x: 120, y: 220, width: 45, height: 20 } },
      { text: 'THRU', confidence: 95, bbox: { x: 175, y: 220, width: 45, height: 20 } },
      { text: '01/18', confidence: 97, bbox: { x: 230, y: 220, width: 50, height: 20 } },
      { text: 'COMPANY', confidence: 95, bbox: { x: 50, y: 280, width: 90, height: 20 } },
      { text: 'NAME', confidence: 95, bbox: { x: 150, y: 280, width: 50, height: 20 } },
      { text: 'M', confidence: 95, bbox: { x: 210, y: 280, width: 15, height: 20 } },
      { text: 'STEPHENS', confidence: 95, bbox: { x: 235, y: 280, width: 90, height: 20 } },
      { text: 'MasterCard', confidence: 98, bbox: { x: 450, y: 280, width: 100, height: 30 } }
    ];

    const result = PIIDetector.detectPII(cardWords);

    // Card number and expiry should both be detected
    const cardMatches = result.matches.filter((m: any) => m.type === 'CARD');
    expect(cardMatches.length).toBeGreaterThanOrEqual(2);

    // Verify 16-digit card number detection
    const fullCardMatch = cardMatches.find((m: any) => m.matchedText.includes('5476'));
    expect(fullCardMatch).toBeDefined();
    expect(fullCardMatch.matchedText).toContain('5476 7678 9876 5432');
    expect(fullCardMatch.bbox.width).toBeGreaterThanOrEqual(550); // Covers from x:50 to x:610

    // Verify expiry date detection
    const expiryMatch = cardMatches.find((m: any) => m.matchedText.includes('01/18'));
    expect(expiryMatch).toBeDefined();
  });

  it('detects CVV and American Express card formats', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PIIDetector = require('../pii-detector');

    const amexAndCvvWords = [
      { text: 'Amex:', confidence: 95, bbox: { x: 50, y: 50, width: 45, height: 18 } },
      { text: '3782', confidence: 98, bbox: { x: 105, y: 50, width: 50, height: 18 } },
      { text: '822463', confidence: 98, bbox: { x: 165, y: 50, width: 70, height: 18 } },
      { text: '10005', confidence: 98, bbox: { x: 245, y: 50, width: 60, height: 18 } },
      { text: 'CVV:', confidence: 95, bbox: { x: 50, y: 100, width: 40, height: 18 } },
      { text: '849', confidence: 99, bbox: { x: 100, y: 100, width: 35, height: 18 } }
    ];

    const result = PIIDetector.detectPII(amexAndCvvWords);
    const cardMatches = result.matches.filter((m: any) => m.type === 'CARD');
    expect(cardMatches.length).toBe(2);

    const amexMatch = cardMatches.find((m: any) => m.matchedText.includes('3782'));
    expect(amexMatch).toBeDefined();

    const cvvMatch = cardMatches.find((m: any) => m.matchedText.includes('849'));
    expect(cvvMatch).toBeDefined();
  });

  it('detects cards even when OCR confuses embossed 5 with S, 0 with O, or merges blocks', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PIIDetector = require('../pii-detector');

    expect(PIIDetector.normalizeOcrCardDigits('S476 7789875 5432')).toBe('547677898755432');
    expect(PIIDetector.normalizeOcrCardDigits('4532 O15O I234 567I')).toBe('4532015012345671');

    // Exactly matching the tokens produced by Tesseract on the user's Barclaycard screenshot
    const userScreenshotWords = [
      { text: 'Input', confidence: 90, bbox: { x: 504, y: 152, width: 33, height: 12 } },
      { text: 'barclaycard', confidence: 90, bbox: { x: 405, y: 179, width: 126, height: 43 } },
      { text: 'ser', confidence: 90, bbox: { x: 597, y: 181, width: 81, height: 54 } },
      { text: 'S476', confidence: 90, bbox: { x: 385, y: 290, width: 54, height: 18 } },
      { text: '7789875', confidence: 90, bbox: { x: 457, y: 289, width: 125, height: 19 } },
      { text: '5432', confidence: 90, bbox: { x: 601, y: 290, width: 53, height: 18 } }
    ];

    const result = PIIDetector.detectPII(userScreenshotWords);
    const cardMatches = result.matches.filter((m: any) => m.type === 'CARD');
    expect(cardMatches.length).toBe(1);

    const match = cardMatches[0];
    expect(match.matchedText).toBe('S476 7789875 5432');
    // Box should cover all 3 card number tokens from x:385 to x:654
    expect(match.bbox.x).toBe(385);
    expect(match.bbox.width).toBe(269);
  });

  it('does NOT falsely match English phrases or sample document descriptions as CARD', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PIIDetector = require('../pii-detector');

    const sampleDocWords = [
      { text: 'The', confidence: 90, bbox: { x: 10, y: 10, width: 25, height: 18 } },
      { text: 'document', confidence: 90, bbox: { x: 40, y: 10, width: 50, height: 18 } },
      { text: 'is', confidence: 90, bbox: { x: 95, y: 10, width: 15, height: 18 } },
      { text: 'an', confidence: 90, bbox: { x: 115, y: 10, width: 15, height: 18 } },
      { text: 'Aadhaar', confidence: 90, bbox: { x: 135, y: 10, width: 50, height: 18 } },
      { text: 'card', confidence: 90, bbox: { x: 190, y: 10, width: 30, height: 18 } },
      { text: 'issued', confidence: 90, bbox: { x: 225, y: 10, width: 40, height: 18 } },
      { text: 'by', confidence: 90, bbox: { x: 270, y: 10, width: 20, height: 18 } },
      { text: 'the', confidence: 90, bbox: { x: 295, y: 10, width: 25, height: 18 } },
      { text: 'Unique', confidence: 90, bbox: { x: 325, y: 10, width: 45, height: 18 } },
      { text: 'Identification', confidence: 90, bbox: { x: 375, y: 10, width: 80, height: 18 } },
      { text: 'Sign', confidence: 90, bbox: { x: 10, y: 50, width: 30, height: 18 } },
      { text: 'In', confidence: 90, bbox: { x: 45, y: 50, width: 15, height: 18 } },
      { text: 'Download', confidence: 90, bbox: { x: 65, y: 50, width: 60, height: 18 } },
      { text: 'free', confidence: 90, bbox: { x: 130, y: 50, width: 30, height: 18 } },
      { text: 'for', confidence: 90, bbox: { x: 165, y: 50, width: 20, height: 18 } },
      { text: '30', confidence: 90, bbox: { x: 190, y: 50, width: 20, height: 18 } },
      { text: 'days', confidence: 90, bbox: { x: 215, y: 50, width: 30, height: 18 } },
      { text: 'You', confidence: 90, bbox: { x: 10, y: 90, width: 25, height: 18 } },
      { text: 'might', confidence: 90, bbox: { x: 40, y: 90, width: 35, height: 18 } },
      { text: 'also', confidence: 90, bbox: { x: 80, y: 90, width: 30, height: 18 } },
      { text: 'like', confidence: 90, bbox: { x: 115, y: 90, width: 25, height: 18 } }
    ];

    const result = PIIDetector.detectPII(sampleDocWords);
    const cardMatches = result.matches.filter((m: any) => m.type === 'CARD');
    expect(cardMatches.length).toBe(0);
  });

  it('detects 16-digit card when OCR recognizes OCR-A font digits with k and h substitutions', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PIIDetector = require('../pii-detector');

    const lowResWords = [
      { text: '2)', confidence: 75, bbox: { x: 129, y: 74, width: 22, height: 29 } },
      { text: 'barclaycard', confidence: 90, bbox: { x: 159, y: 74, width: 77, height: 29 } },
      { text: '=', confidence: 60, bbox: { x: 279, y: 79, width: 47, height: 28 } },
      { text: ')', confidence: 50, bbox: { x: 312, y: 116, width: 14, height: 17 } },
      { text: '547k', confidence: 85, bbox: { x: 147, y: 143, width: 32, height: 11 } },
      { text: '7h78,987k', confidence: 80, bbox: { x: 191, y: 143, width: 76, height: 11 } },
      { text: '5432', confidence: 90, bbox: { x: 279, y: 143, width: 33, height: 11 } }
    ];

    const result = PIIDetector.detectPII(lowResWords);
    const cardMatches = result.matches.filter((m: any) => m.type === 'CARD');
    expect(cardMatches.length).toBe(1);

    const match = cardMatches[0];
    expect(match.matchedText).toBe('547k 7h78,987k 5432');
    expect(match.bbox.x).toBe(147);
    expect(match.bbox.width).toBe(165);
  });

  it('detects 16-digit card when embossed digits have heavy OCR degradation (SH7h PERE 9676 5432)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PIIDetector = require('../pii-detector');

    const degradedWords = [
      { text: 'Input', confidence: 95, bbox: { x: 278, y: 56, width: 44, height: 17 } },
      { text: 'Dpocoucd', confidence: 0, bbox: { x: 100, y: 97, width: 207, height: 55 } },
      { text: 'wil', confidence: 48, bbox: { x: 401, y: 99, width: 97, height: 58 } },
      { text: 'D))]', confidence: 56, bbox: { x: 469, y: 177, width: 29, height: 35 } },
      { text: 'SH7h', confidence: 0, bbox: { x: 127, y: 232, width: 69, height: 41 } },
      { text: 'PERE', confidence: 4, bbox: { x: 218, y: 232, width: 68, height: 23 } },
      { text: '9676', confidence: 4, bbox: { x: 308, y: 232, width: 69, height: 23 } },
      { text: '5432', confidence: 64, bbox: { x: 401, y: 232, width: 68, height: 23 } },
      { text: '=a]', confidence: 31, bbox: { x: 115, y: 285, width: 73, height: 36 } },
      { text: 'i', confidence: 30, bbox: { x: 206, y: 293, width: 17, height: 28 } },
      { text: 'R', confidence: 51, bbox: { x: 243, y: 285, width: 24, height: 32 } },
      { text: '01778', confidence: 68, bbox: { x: 290, y: 284, width: 51, height: 14 } }
    ];

    const result = PIIDetector.detectPII(degradedWords);
    const cardMatches = result.matches.filter((m: any) => m.type === 'CARD');
    expect(cardMatches.length).toBe(1);

    const match = cardMatches[0];
    expect(match.matchedText).toBe('SH7h PERE 9676 5432');
    expect(match.bbox.x).toBe(127);
    expect(match.bbox.width).toBe(342);
  });

  it('detects all 16-digit card numbers with various prefixes (0, 1, 7, 8, 9) in spreadsheet data', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PIIDetector = require('../pii-detector');

    const sheetCardNumbers = [
      '8469788093208196',
      '0457178472671475',
      '8193319084520599',
      '1622948662836016',
      '7517799229836957',
      '0737028382226468',
      '8983194893949482',
      '8549145244106460',
      '1280845850037038',
      '7787943262705860',
      '8452630976582802',
      '5996775003145037',
      '9876543210126456'
    ];

    const words = sheetCardNumbers.map((num, idx) => ({
      text: num,
      confidence: 95,
      bbox: { x: 100, y: 50 + idx * 30, width: 150, height: 20 }
    }));

    const result = PIIDetector.detectPII(words);
    const cardMatches = result.matches.filter((m: any) => m.type === 'CARD');
    expect(cardMatches.length).toBe(sheetCardNumbers.length);
  });

  it('detects 3-block embossed cards even with severe OCR middle token degradation (S476 Msp S432)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PIIDetector = require('../pii-detector');

    const cardWords = [
      { text: 'S476', confidence: 90, bbox: { x: 183, y: 99, width: 29, height: 17 } },
      { text: 'Msp', confidence: 50, bbox: { x: 222, y: 99, width: 67, height: 10 } },
      { text: 'S432', confidence: 90, bbox: { x: 299, y: 99, width: 28, height: 10 } }
    ];

    const result = PIIDetector.detectPII(cardWords);
    const cardMatches = result.matches.filter((m: any) => m.type === 'CARD');
    expect(cardMatches.length).toBe(1);

    const match = cardMatches[0];
    expect(match.matchedText).toBe('S476 Msp S432');
    expect(match.bbox.x).toBe(183);
    expect(match.bbox.width).toBe(144);
  });

  describe('Confidence-Aware Handling for Luhn Cards vs other PII', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PIIDetector = require('../pii-detector');

    it('accepts Luhn-valid card with 25% OCR confidence without flagging lowConfidence or blocking', () => {
      // 4532 0150 1234 5671 is Luhn-valid (ends in 1)
      const words = [
        { text: '4532', confidence: 25, bbox: { x: 100, y: 100, width: 40, height: 20 } },
        { text: '0150', confidence: 25, bbox: { x: 145, y: 100, width: 40, height: 20 } },
        { text: '1234', confidence: 25, bbox: { x: 190, y: 100, width: 40, height: 20 } },
        { text: '5671', confidence: 25, bbox: { x: 235, y: 100, width: 40, height: 20 } }
      ];

      const result = PIIDetector.detectPII(words);
      const cardMatch = result.matches.find((m: any) => m.type === 'CARD');
      expect(cardMatch).toBeDefined();
      expect(cardMatch.isLowConfidence).toBe(false);
      expect(cardMatch.isLuhnValid).toBe(true);
      expect(result.summary.lowConfidenceCount).toBe(0);
      expect(result.isBlocked).toBe(false);
    });

    it('flags non-card PII (EMAIL, PHONE, OTP) at 25% confidence as lowConfidence and BLOCKED', () => {
      const emailWords = [
        { text: 'sarah.connor@cyberdyne.io', confidence: 25, bbox: { x: 50, y: 50, width: 180, height: 20 } }
      ];
      const emailResult = PIIDetector.detectPII(emailWords);
      expect(emailResult.matches.length).toBe(1);
      expect(emailResult.matches[0].isLowConfidence).toBe(true);
      expect(emailResult.isBlocked).toBe(true);

      const phoneWords = [
        { text: '+91', confidence: 25, bbox: { x: 50, y: 100, width: 30, height: 20 } },
        { text: '9876543210', confidence: 25, bbox: { x: 85, y: 100, width: 80, height: 20 } }
      ];
      const phoneResult = PIIDetector.detectPII(phoneWords);
      expect(phoneResult.matches.length).toBe(1);
      expect(phoneResult.matches[0].isLowConfidence).toBe(true);
      expect(phoneResult.isBlocked).toBe(true);

      const otpWords = [
        { text: 'OTP:', confidence: 95, bbox: { x: 50, y: 150, width: 35, height: 20 } },
        { text: '894210', confidence: 25, bbox: { x: 90, y: 150, width: 50, height: 20 } }
      ];
      const otpResult = PIIDetector.detectPII(otpWords);
      const otpMatch = otpResult.matches.find((m: any) => m.type === 'OTP');
      expect(otpMatch).toBeDefined();
      expect(otpMatch.isLowConfidence).toBe(true);
      expect(otpResult.isBlocked).toBe(true);
    });

    it('flags invalid-checksum card at 25% confidence as lowConfidence and BLOCKED', () => {
      // 4532 0150 1234 5675 has invalid Luhn checksum (ends in 5 instead of 1)
      const words = [
        { text: '4532', confidence: 25, bbox: { x: 100, y: 100, width: 40, height: 20 } },
        { text: '0150', confidence: 25, bbox: { x: 145, y: 100, width: 40, height: 20 } },
        { text: '1234', confidence: 25, bbox: { x: 190, y: 100, width: 40, height: 20 } },
        { text: '5675', confidence: 25, bbox: { x: 235, y: 100, width: 40, height: 20 } }
      ];

      const result = PIIDetector.detectPII(words);
      const cardMatch = result.matches.find((m: any) => m.type === 'CARD');
      expect(cardMatch).toBeDefined();
      expect(cardMatch.isLowConfidence).toBe(true);
      expect(result.isBlocked).toBe(true);
    });

    it('flags Luhn-valid card below 20.0% threshold (e.g. 15%) as lowConfidence', () => {
      const words = [
        { text: '4532', confidence: 15, bbox: { x: 100, y: 100, width: 40, height: 20 } },
        { text: '0150', confidence: 15, bbox: { x: 145, y: 100, width: 40, height: 20 } },
        { text: '1234', confidence: 15, bbox: { x: 190, y: 100, width: 40, height: 20 } },
        { text: '5671', confidence: 15, bbox: { x: 235, y: 100, width: 40, height: 20 } }
      ];

      const result = PIIDetector.detectPII(words);
      const cardMatch = result.matches.find((m: any) => m.type === 'CARD');
      expect(cardMatch).toBeDefined();
      expect(cardMatch.isLowConfidence).toBe(true);
      expect(result.isBlocked).toBe(true);
    });
  });

  describe('Cross-Validation Safety Check ("Position Uncertain")', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PIIDetector = require('../pii-detector');

    it('triggers position uncertain when DOM match and OCR match reference similar text but dx > 40px', () => {
      const domMatches = [
        { type: 'CARD', matchedText: '4532 0150 1234 5671', bbox: { x: 100, y: 200, width: 200, height: 30 } }
      ];
      const ocrMatches = [
        { type: 'CARD', matchedText: '4532 0150 1234 5671', bbox: { x: 160, y: 200, width: 200, height: 30 } }
      ];

      const cv = PIIDetector.crossValidatePositions(domMatches, ocrMatches, { maxDistance: 40 });
      expect(cv.isPositionUncertain).toBe(true);
      expect(cv.uncertainPairs.length).toBe(1);
      expect(cv.uncertainPairs[0].dx).toBe(60);
      expect(cv.reason).toBe('Sensitive match found but position could not be confirmed — review manually.');
    });

    it('triggers position uncertain when dy > 40px', () => {
      const domMatches = [
        { type: 'EMAIL', matchedText: 'sarah.connor@cyberdyne.io', bbox: { x: 100, y: 200, width: 180, height: 25 } }
      ];
      const ocrMatches = [
        { type: 'EMAIL', matchedText: 'sarah.connor@cyberdyne.io', bbox: { x: 100, y: 260, width: 180, height: 25 } }
      ];

      const cv = PIIDetector.crossValidatePositions(domMatches, ocrMatches, { maxDistance: 40 });
      expect(cv.isPositionUncertain).toBe(true);
      expect(cv.uncertainPairs[0].dy).toBe(60);
    });

    it('does NOT trigger position uncertain when coordinates agree within 40px tolerance', () => {
      const domMatches = [
        { type: 'CARD', matchedText: '4532 0150 1234 5671', bbox: { x: 100, y: 200, width: 200, height: 30 } }
      ];
      const ocrMatches = [
        { type: 'CARD', matchedText: '4532 0150 1234 5671', bbox: { x: 115, y: 210, width: 195, height: 28 } }
      ];

      const cv = PIIDetector.crossValidatePositions(domMatches, ocrMatches, { maxDistance: 40 });
      expect(cv.isPositionUncertain).toBe(false);
      expect(cv.uncertainPairs.length).toBe(0);
      expect(cv.reason).toBe('');
    });

    it('does NOT trigger position uncertain for completely different text items', () => {
      const domMatches = [
        { type: 'CARD', matchedText: '4532 0150 1234 5671', bbox: { x: 100, y: 200, width: 200, height: 30 } }
      ];
      const ocrMatches = [
        { type: 'CARD', matchedText: '5425 2334 3010 9879', bbox: { x: 500, y: 600, width: 200, height: 30 } }
      ];

      const cv = PIIDetector.crossValidatePositions(domMatches, ocrMatches, { maxDistance: 40 });
      expect(cv.isPositionUncertain).toBe(false);
    });
  });
});




