const difficulties = new Set(["基础", "中等", "进阶"]);
const placeholderPattern = /\b(?:TODO|TBD)\b|待补(?:充|全|完善)?|占位|同上|^\s*略\s*$/iu;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function includesPlaceholder(value) {
  return typeof value === "string" && placeholderPattern.test(value);
}

function validateText(errors, field, value, { checkPlaceholder = true } = {}) {
  if (!isNonEmptyString(value)) {
    errors.push(`${field} must be a non-empty string`);
    return;
  }
  if (checkPlaceholder && includesPlaceholder(value)) {
    errors.push(`${field} contains a placeholder`);
  }
}

export function validateAnswerRecord(record, sourceIds) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return ["record must be an object"];
  }

  const errors = [];
  validateText(errors, "sourceId", record.sourceId, { checkPlaceholder: false });
  if (isNonEmptyString(record.sourceId) && (!(sourceIds instanceof Set) || !sourceIds.has(record.sourceId))) {
    errors.push(`sourceId does not exist: ${record.sourceId}`);
  }

  validateText(errors, "shortAnswer", record.shortAnswer);
  validateText(errors, "fullAnswer", record.fullAnswer);
  if (isNonEmptyString(record.fullAnswer)) {
    const chineseCharacters = record.fullAnswer.match(/\p{Script=Han}/gu)?.length ?? 0;
    const englishWords = record.fullAnswer
      .trim()
      .split(/\s+/u)
      .filter((word) => /[A-Za-z]/u.test(word)).length;
    if (chineseCharacters < 80 && englishWords < 45) {
      errors.push(`fullAnswer is too short: requires 80 Chinese characters or 45 English words; received ${chineseCharacters} Chinese characters and ${englishWords} English words`);
    }
  }

  if (!Array.isArray(record.followUps) || record.followUps.length < 2 || record.followUps.length > 3) {
    errors.push("followUps must contain 2 or 3 items");
  }
  if (Array.isArray(record.followUps)) {
    for (const [index, followUp] of record.followUps.entries()) {
      if (!followUp || typeof followUp !== "object" || Array.isArray(followUp)) {
        errors.push(`followUps[${index}] must be an object`);
        continue;
      }
      validateText(errors, `followUps[${index}].question`, followUp.question);
      validateText(errors, `followUps[${index}].answer`, followUp.answer);
    }
  }

  for (const field of ["pitfalls", "tags"]) {
    const values = record[field];
    if (!Array.isArray(values) || values.length < 1) {
      errors.push(`${field} must contain at least 1 item`);
      continue;
    }
    for (const [index, value] of values.entries()) {
      validateText(errors, `${field}[${index}]`, value);
    }
  }

  if (!difficulties.has(record.difficulty)) {
    errors.push("difficulty must be one of 基础, 中等, 进阶");
  }
  if (record.contextNote !== undefined && typeof record.contextNote !== "string") {
    errors.push("contextNote must be a string when provided");
  } else if (includesPlaceholder(record.contextNote)) {
    errors.push("contextNote contains a placeholder");
  }

  return errors;
}

export function normalizedFullAnswer(fullAnswer) {
  return fullAnswer.replace(/\s+/gu, " ").trim();
}
