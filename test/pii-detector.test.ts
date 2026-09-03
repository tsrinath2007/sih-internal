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
});
