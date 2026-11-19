import Ajv from 'ajv';
import type { ValidateFunction } from 'ajv';
import ajvErrors from 'ajv-errors';
import type { JsonSchema } from './catalog';

/** The schemas use `errorMessage` and keywords AJV doesn't know, hence ajv-errors and `strict: false`. */
export function compileSchema(schema: JsonSchema): ValidateFunction {
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajvErrors(ajv);
  return ajv.compile(schema);
}
