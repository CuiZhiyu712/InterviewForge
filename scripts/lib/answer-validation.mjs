const difficulties = new Set(["基础", "中等", "进阶"]);
const zeroWidthPattern = /[\u200B-\u200D\u2060\uFEFF]/gu;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function includesPlaceholder(value) {
  if (typeof value !== "string") return false;
  const compact = value
    .normalize("NFKC")
    .replace(zeroWidthPattern, "")
    .trim()
    .replace(/[\s.,，。!！?？:：;；\-_—()[\]{}"'“”‘’]+/gu, "")
    .toLowerCase();
  return /^(?:(?:todo|tbd)(?:后续)?(?:补充|完善)?|待补(?:充)?|待完善|略|同上|占位(?:答案|内容|文本)?|暂无(?:答案|内容)?)$/u.test(compact);
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
    const visibleText = record.fullAnswer.normalize("NFKC").replace(zeroWidthPattern, "");
    const chineseCharacters = visibleText.match(/\p{Script=Han}/gu)?.length ?? 0;
    const englishWords = (visibleText.match(/[A-Za-z][A-Za-z0-9'’-]*/gu) ?? [])
      .filter((word) => (word.match(/[A-Za-z]/gu)?.length ?? 0) >= 2).length;
    const weightedLength = chineseCharacters + (englishWords * 80) / 45;
    if (weightedLength < 80) {
      errors.push(`fullAnswer is too short: requires a weighted length of 80 (one Chinese character or 80/45 of a substantive English word); received ${chineseCharacters} Chinese characters and ${englishWords} substantive English words`);
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
  return fullAnswer
    .normalize("NFKC")
    .replace(zeroWidthPattern, "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/(?<=\p{Script=Han})\s+|\s+(?=\p{Script=Han})/gu, "");
}
