import { LintConfig, RuleConfig } from '../../../../config/config';
import { parseYamlToDocument } from '../../../../../__tests__/utils';
import { lintDocument } from '../../../../lint';
import { BaseResolver } from '../../../../resolve';

export async function lintDoc(
  source: string,
  rules: Record<string, RuleConfig> = { spec: 'error' },
) {
  const document = parseYamlToDocument(source, 'foobar.yaml');

  const results = await lintDocument({
    externalRefResolver: new BaseResolver(),
    document,
    config: new LintConfig({
      extends: [],
      rules,
    }),
  });

  return results.map((res) => {
    return {
      message: res.message,
      location: res.location[0].pointer || '',
    };
  });
}