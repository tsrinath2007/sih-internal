// extension/content/pii-detector-dom.ts
function luhnCheck(numStr) {
  const digits = numStr.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}
function detectDOMPII(snapshot) {
  const detections = [];
  let counter = 1;
  for (const el of snapshot.elements) {
    const val = (el.value || el.text || "").trim();
    if (!val || val.length < 2) continue;
    if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(val) || el.autocomplete === "email" || el.type === "email" || /email/i.test(el.name || "") || /email/i.test(el.placeholder || "")) {
      if (val.includes("@") || el.type === "email" || el.autocomplete === "email") {
        detections.push({
          id: `pii-email-${counter++}`,
          type: "EMAIL",
          originalValue: val,
          surrogateValue: `alex.user${counter}@example.com`,
          selector: el.selector,
          bbox: el.bbox,
          confidence: 0.99
        });
        continue;
      }
    }
    const digitsOnly = val.replace(/\D/g, "");
    if (el.autocomplete === "cc-number" || /card|credit|debit|ccnum/i.test(el.name || "") || /card number/i.test(el.placeholder || "") || digitsOnly.length >= 13 && digitsOnly.length <= 19 && luhnCheck(digitsOnly)) {
      if (digitsOnly.length >= 12 || luhnCheck(digitsOnly)) {
        detections.push({
          id: `pii-card-${counter++}`,
          type: "CARD",
          originalValue: val,
          surrogateValue: "**** **** **** 1234",
          selector: el.selector,
          bbox: el.bbox,
          confidence: 0.98
        });
        continue;
      }
    }
    if (el.autocomplete === "tel" || el.type === "tel" || /phone|mobile|tel/i.test(el.name || "") || /^\+?91[\s\-]?[6-9]\d{9}$/.test(val.replace(/\s+/g, "")) || digitsOnly.length === 12 && digitsOnly.startsWith("91") && /^[6-9]/.test(digitsOnly.slice(2)) || digitsOnly.length === 10 && /^[6-9]/.test(digitsOnly) || /^\+?1?[\s\-\.]?\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}$/.test(val) && digitsOnly.length >= 10) {
      if (digitsOnly.length >= 10) {
        detections.push({
          id: `pii-phone-${counter++}`,
          type: "PHONE",
          originalValue: val,
          surrogateValue: "+1 (555) 019-2834",
          selector: el.selector,
          bbox: el.bbox,
          confidence: 0.95
        });
        continue;
      }
    }
    if (el.autocomplete === "street-address" || el.autocomplete === "address-line1" || /address|street|location/i.test(el.name || "") || /address/i.test(el.placeholder || "")) {
      detections.push({
        id: `pii-address-${counter++}`,
        type: "ADDRESS",
        originalValue: val,
        surrogateValue: "123 Privacy Lane, Suite 400",
        selector: el.selector,
        bbox: el.bbox,
        confidence: 0.92
      });
      continue;
    }
    if (el.autocomplete === "name" || el.autocomplete === "given-name" || el.autocomplete === "family-name" || el.autocomplete === "cc-name" || /^name|full_?name|fname|lname|customer_?name$/i.test(el.name || "") || /^full name|your name|enter name$/i.test(el.placeholder || "")) {
      if (val.length > 2 && !/submit|button|login|signup|reset/i.test(val)) {
        detections.push({
          id: `pii-name-${counter++}`,
          type: "NAME",
          originalValue: val,
          surrogateValue: "Alex Mercer",
          selector: el.selector,
          bbox: el.bbox,
          confidence: 0.9
        });
      }
    }
  }
  return detections;
}
export {
  detectDOMPII,
  luhnCheck
};
//# sourceMappingURL=pii-detector-dom.js.map
