/* ==========================================================================
   SUBLETWORKS.COM — Contact Masking Engine
   Detects & redacts phone numbers, emails, UPI IDs and spelled-out numbers
   (English words, Hindi-transliteration words and Devanagari script/digits)
   so contractors and project managers cannot exchange direct contact info
   before both sides pay the one-time Contact Unlock fee.
   ========================================================================== */
(function(global){
  "use strict";

  const DEVANAGARI_DIGITS = {"०":"0","१":"1","२":"2","३":"3","४":"4","५":"5","६":"6","७":"7","८":"8","९":"9"};

  const NUMBER_WORDS = {
    "zero":"0","oh":"0","o":"0","one":"1","two":"2","three":"3","four":"4","five":"5","six":"6","seven":"7","eight":"8","nine":"9",
    "shunya":"0","sunya":"0","ek":"1","do":"2","teen":"3","tin":"3","chaar":"4","char":"4","paanch":"5","panch":"5","che":"6","chhe":"6","cheh":"6","saat":"7","aath":"8","aat":"8","nau":"9","no":"9",
    "शून्य":"0","एक":"1","दो":"2","तीन":"3","चार":"4","पांच":"5","पाँच":"5","छह":"6","छे":"6","सात":"7","आठ":"8","नौ":"9"
  };

  function normalizeDigits(text){
    return text.replace(/[०-९]/g, d => DEVANAGARI_DIGITS[d]);
  }

  // Collapse runs of >=7 recognizable number-words (allowing common connector
  // words like "double", "nine nine" etc.) into a masked block.
  function maskSpelledNumbers(text){
    const tokens = text.split(/(\s+)/); // keep whitespace tokens for rebuild
    let out = [];
    let buffer = [];
    function flush(){
      if(buffer.length >= 6){
        const leadingSpace = buffer.length && /^\s+$/.test(buffer[0].raw) ? buffer[0].raw : "";
        out.push(leadingSpace + "[hidden contact info]");
      } else {
        buffer.forEach(b=>out.push(b.raw));
      }
      buffer = [];
    }
    tokens.forEach(tok=>{
      const clean = tok.trim().toLowerCase().replace(/[.,!]/g,"");
      if(clean === "double" || clean === "triple"){ buffer.push({raw:tok}); return; }
      if(NUMBER_WORDS.hasOwnProperty(clean)){
        buffer.push({raw:tok});
      } else if(/^\s+$/.test(tok)){
        buffer.push({raw:tok});
      } else {
        flush();
        out.push(tok);
      }
    });
    flush();
    return out.join("");
  }

  function maskDigitsSequences(text){
    // phone-like: optional +91/91/0 prefix then 10 digits, possibly split by spaces/dashes/dots
    return text.replace(/(\+?91[\s-]?)?\b(\d[\s-]?){9,12}\d\b/g, (match)=>{
      const digitsOnly = match.replace(/\D/g,"");
      if(digitsOnly.length>=8) return "[hidden number]";
      return match;
    });
  }

  function maskEmails(text){
    return text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[hidden email]");
  }

  function maskUPI(text){
    text = text.replace(/\b[a-zA-Z0-9.\-_]{2,}@(?:okaxis|okhdfcbank|oksbi|okicici|ybl|upi|paytm|apl|axl|ibl|axisb|hdfcbank)\b/gi, "[hidden UPI ID]");
    text = text.replace(/(?<!\[hidden )\b(upi|paytm|gpay|google pay|phonepe|bhim)\s*id\s*[:\-]?\s*\S+/gi, "[hidden UPI ID]");
    return text;
  }

  function maskSocial(text){
    return text.replace(/\bwhatsapp\s*(no|number|par|pe)?\s*[:\-]?\s*[\d\s+-]{7,}/gi, "whatsapp [hidden number]")
               .replace(/\b(instagram|facebook|telegram|fb id|insta id)\s*[:\-]?\s*@?\w+/gi, "[hidden social handle]");
  }

  // Full pipeline used before rendering any chat/comment content
  function maskText(raw){
    if(!raw) return { text:"", masked:false };
    let text = normalizeDigits(raw);
    const before = text;
    text = maskEmails(text);
    text = maskUPI(text);
    text = maskSocial(text);
    text = maskDigitsSequences(text);
    text = maskSpelledNumbers(text);
    return { text, masked: text!==before };
  }

  // Render helper: wraps [hidden ...] tokens in a styled span for chat bubbles
  function maskToHtml(raw, escapeFn){
    const { text } = maskText(raw);
    const esc = escapeFn || (s=>s);
    return esc(text).replace(/\[hidden[^\]]*\]/g, m => `<span class="masked">${m}</span>`);
  }

  global.SW = global.SW || {};
  global.SW.Mask = { maskText, maskToHtml, normalizeDigits };
})(window);
