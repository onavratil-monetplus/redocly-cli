import * as fs from 'fs';
import * as path from 'path';
import { parseYaml, stringifyYaml } from '../js-yaml';
import { slash, doesYamlFileExist } from '../utils';
import { NormalizedProblem } from '../walk';
import {
  SpecVersion,
  SpecMajorVersion,
  Oas2RuleSet,
  Oas3RuleSet,
  Async2RuleSet,
} from '../oas-types';
import { isBrowser, env } from '../env';

import type { NodeType } from '../types';
import type {
  DecoratorConfig,
  Plugin,
  PreprocessorConfig,
  Region,
  ResolveConfig,
  ResolvedApi,
  ResolvedConfig,
  ResolvedStyleguideConfig,
  RuleConfig,
  RuleSettings,
  Telemetry,
  ThemeRawConfig,
} from './types';
import { getResolveConfig } from './utils';
import { isAbsoluteUrl } from '../ref-utils';
import { RedoclyClient } from '../redocly';

export const IGNORE_FILE = '.redocly.lint-ignore.yaml';
const IGNORE_BANNER =
  `# This file instructs Redocly's linter to ignore the rules contained for specific parts of your API.\n` +
  `# See https://redoc.ly/docs/cli/ for more information.\n`;

export const DEFAULT_REGION = 'us';

function getDomains() {
  const domains: { [region in Region]: string } = {
    us: 'redocly.com',
    eu: 'eu.redocly.com',
  };

  // FIXME: temporary fix for our lab environments
  const domain = RedoclyClient?.domain || env.REDOCLY_DOMAIN;
  if (domain?.endsWith('.redocly.host')) {
    domains[domain.split('.')[0] as Region] = domain;
  }
  if (domain === 'redoc.online') {
    domains[domain as Region] = domain;
  }
  return domains;
}

function getIgnoreFilePath(configFile?: string): string | undefined {
  if (configFile) {
    return doesYamlFileExist(configFile)
      ? path.join(path.dirname(configFile), IGNORE_FILE)
      : path.join(configFile, IGNORE_FILE);
  } else {
    return isBrowser ? undefined : path.join(process.cwd(), IGNORE_FILE);
  }
}

export const DOMAINS = getDomains();
export const AVAILABLE_REGIONS = Object.keys(DOMAINS) as Region[];

export class StyleguideConfig {
  plugins: Plugin[];
  ignore: Record<string, Record<string, Set<string>>> = {};
  doNotResolveExamples: boolean;
  rules: Record<SpecVersion, Record<string, RuleConfig>>;
  preprocessors: Record<SpecVersion, Record<string, PreprocessorConfig>>;
  decorators: Record<SpecVersion, Record<string, DecoratorConfig>>;

  private _usedRules: Set<string> = new Set();
  private _usedVersions: Set<SpecVersion> = new Set();

  recommendedFallback: boolean;

  extendPaths: string[];
  pluginPaths: string[];

  constructor(public rawConfig: ResolvedStyleguideConfig, public configFile?: string) {
    this.plugins = rawConfig.plugins || [];
    this.doNotResolveExamples = !!rawConfig.doNotResolveExamples;
    this.recommendedFallback = rawConfig.recommendedFallback || false;

    this.rules = {
      [SpecVersion.OAS2]: { ...rawConfig.rules, ...rawConfig.oas2Rules },
      [SpecVersion.OAS3_0]: { ...rawConfig.rules, ...rawConfig.oas3_0Rules },
      [SpecVersion.OAS3_1]: { ...rawConfig.rules, ...rawConfig.oas3_1Rules },
      [SpecVersion.Async2]: { ...rawConfig.rules, ...rawConfig.async2Rules },
    };

    this.preprocessors = {
      [SpecVersion.OAS2]: { ...rawConfig.preprocessors, ...rawConfig.oas2Preprocessors },
      [SpecVersion.OAS3_0]: { ...rawConfig.preprocessors, ...rawConfig.oas3_0Preprocessors },
      [SpecVersion.OAS3_1]: { ...rawConfig.preprocessors, ...rawConfig.oas3_1Preprocessors },
      [SpecVersion.Async2]: { ...rawConfig.preprocessors, ...rawConfig.async2Preprocessors },
    };

    this.decorators = {
      [SpecVersion.OAS2]: { ...rawConfig.decorators, ...rawConfig.oas2Decorators },
      [SpecVersion.OAS3_0]: { ...rawConfig.decorators, ...rawConfig.oas3_0Decorators },
      [SpecVersion.OAS3_1]: { ...rawConfig.decorators, ...rawConfig.oas3_1Decorators },
      [SpecVersion.Async2]: { ...rawConfig.decorators, ...rawConfig.async2Decorators },
    };

    this.extendPaths = rawConfig.extendPaths || [];
    this.pluginPaths = rawConfig.pluginPaths || [];
    this.resolveIgnore(getIgnoreFilePath(configFile));
  }

  resolveIgnore(ignoreFile?: string) {
    if (!ignoreFile || !doesYamlFileExist(ignoreFile)) return;

    this.ignore =
      (parseYaml(fs.readFileSync(ignoreFile, 'utf-8')) as Record<
        string,
        Record<string, Set<string>>
      >) || {};

    // resolve ignore paths
    for (const fileName of Object.keys(this.ignore)) {
      this.ignore[
        isAbsoluteUrl(fileName) ? fileName : path.resolve(path.dirname(ignoreFile), fileName)
      ] = this.ignore[fileName];

      for (const ruleId of Object.keys(this.ignore[fileName])) {
        this.ignore[fileName][ruleId] = new Set(this.ignore[fileName][ruleId]);
      }

      if (!isAbsoluteUrl(fileName)) {
        delete this.ignore[fileName];
      }
    }
  }

  saveIgnore() {
    const dir = this.configFile ? path.dirname(this.configFile) : process.cwd();
    const ignoreFile = path.join(dir, IGNORE_FILE);
    const mapped: Record<string, any> = {};
    for (const absFileName of Object.keys(this.ignore)) {
      const mappedDefinitionName = isAbsoluteUrl(absFileName)
        ? absFileName
        : slash(path.relative(dir, absFileName));
      const ignoredRules = (mapped[mappedDefinitionName] = this.ignore[absFileName]);

      for (const ruleId of Object.keys(ignoredRules)) {
        ignoredRules[ruleId] = Array.from(ignoredRules[ruleId]) as any;
      }
    }
    fs.writeFileSync(ignoreFile, IGNORE_BANNER + stringifyYaml(mapped));
  }

  addIgnore(problem: NormalizedProblem) {
    const ignore = this.ignore;
    const loc = problem.location[0];
    if (loc.pointer === undefined) return;

    const fileIgnore = (ignore[loc.source.absoluteRef] = ignore[loc.source.absoluteRef] || {});
    const ruleIgnore = (fileIgnore[problem.ruleId] = fileIgnore[problem.ruleId] || new Set());

    ruleIgnore.add(loc.pointer);
  }

  addProblemToIgnore(problem: NormalizedProblem) {
    const loc = problem.location[0];
    if (loc.pointer === undefined) return problem;

    const fileIgnore = this.ignore[loc.source.absoluteRef] || {};
    const ruleIgnore = fileIgnore[problem.ruleId];
    const ignored = ruleIgnore && ruleIgnore.has(loc.pointer);
    return ignored
      ? {
          ...problem,
          ignored,
        }
      : problem;
  }

  extendTypes(types: Record<string, NodeType>, version: SpecVersion) {
    let extendedTypes = types;
    for (const plugin of this.plugins) {
      if (plugin.typeExtension !== undefined) {
        switch (version) {
          case SpecVersion.OAS3_0:
          case SpecVersion.OAS3_1:
            if (!plugin.typeExtension.oas3) continue;
            extendedTypes = plugin.typeExtension.oas3(extendedTypes, version);
            break;
          case SpecVersion.OAS2:
            if (!plugin.typeExtension.oas2) continue;
            extendedTypes = plugin.typeExtension.oas2(extendedTypes, version);
            break;
          case SpecVersion.Async2:
            if (!plugin.typeExtension.async2) continue;
            extendedTypes = plugin.typeExtension.async2(extendedTypes, version);
            break;
          default:
            throw new Error('Not implemented');
        }
      }
    }
    return extendedTypes;
  }

  getRuleSettings(ruleId: string, oasVersion: SpecVersion): RuleSettings {
    this._usedRules.add(ruleId);
    this._usedVersions.add(oasVersion);
    const settings = this.rules[oasVersion][ruleId] || 'off';
    if (typeof settings === 'string') {
      return {
        severity: settings,
      };
    } else {
      return { severity: 'error', ...settings };
    }
  }

  getPreprocessorSettings(ruleId: string, oasVersion: SpecVersion): RuleSettings {
    this._usedRules.add(ruleId);
    this._usedVersions.add(oasVersion);

    const settings = this.preprocessors[oasVersion][ruleId] || 'off';
    if (typeof settings === 'string') {
      return {
        severity: settings === 'on' ? 'error' : settings,
      };
    } else {
      return { severity: 'error', ...settings };
    }
  }

  getDecoratorSettings(ruleId: string, oasVersion: SpecVersion): RuleSettings {
    this._usedRules.add(ruleId);
    this._usedVersions.add(oasVersion);
    const settings = this.decorators[oasVersion][ruleId] || 'off';
    if (typeof settings === 'string') {
      return {
        severity: settings === 'on' ? 'error' : settings,
      };
    } else {
      return { severity: 'error', ...settings };
    }
  }

  getUnusedRules() {
    const rules = [];
    const decorators = [];
    const preprocessors = [];

    for (const usedVersion of Array.from(this._usedVersions)) {
      rules.push(
        ...Object.keys(this.rules[usedVersion]).filter((name) => !this._usedRules.has(name))
      );
      decorators.push(
        ...Object.keys(this.decorators[usedVersion]).filter((name) => !this._usedRules.has(name))
      );
      preprocessors.push(
        ...Object.keys(this.preprocessors[usedVersion]).filter((name) => !this._usedRules.has(name))
      );
    }

    return {
      rules,
      preprocessors,
      decorators,
    };
  }

  getRulesForOasVersion(version: SpecMajorVersion) {
    switch (version) {
      case SpecMajorVersion.OAS3:
        // eslint-disable-next-line no-case-declarations
        const oas3Rules: Oas3RuleSet[] = []; // default ruleset
        this.plugins.forEach((p) => p.preprocessors?.oas3 && oas3Rules.push(p.preprocessors.oas3));
        this.plugins.forEach((p) => p.rules?.oas3 && oas3Rules.push(p.rules.oas3));
        this.plugins.forEach((p) => p.decorators?.oas3 && oas3Rules.push(p.decorators.oas3));
        return oas3Rules;
      case SpecMajorVersion.OAS2:
        // eslint-disable-next-line no-case-declarations
        const oas2Rules: Oas2RuleSet[] = []; // default ruleset
        this.plugins.forEach((p) => p.preprocessors?.oas2 && oas2Rules.push(p.preprocessors.oas2));
        this.plugins.forEach((p) => p.rules?.oas2 && oas2Rules.push(p.rules.oas2));
        this.plugins.forEach((p) => p.decorators?.oas2 && oas2Rules.push(p.decorators.oas2));
        return oas2Rules;
      case SpecMajorVersion.Async2:
        // eslint-disable-next-line no-case-declarations
        const asyncApiRules: Async2RuleSet[] = []; // default ruleset
        this.plugins.forEach(
          (p) => p.preprocessors?.async2 && asyncApiRules.push(p.preprocessors.async2)
        );
        this.plugins.forEach((p) => p.rules?.async2 && asyncApiRules.push(p.rules.async2));
        this.plugins.forEach(
          (p) => p.decorators?.async2 && asyncApiRules.push(p.decorators.async2)
        );
        return asyncApiRules;
    }
  }

  skipRules(rules?: string[]) {
    for (const ruleId of rules || []) {
      for (const version of Object.values(SpecVersion)) {
        if (this.rules[version][ruleId]) {
          this.rules[version][ruleId] = 'off';
        }
      }
    }
  }

  skipPreprocessors(preprocessors?: string[]) {
    for (const preprocessorId of preprocessors || []) {
      for (const version of Object.values(SpecVersion)) {
        if (this.preprocessors[version][preprocessorId]) {
          this.preprocessors[version][preprocessorId] = 'off';
        }
      }
    }
  }

  skipDecorators(decorators?: string[]) {
    for (const decoratorId of decorators || []) {
      for (const version of Object.values(SpecVersion)) {
        if (this.decorators[version][decoratorId]) {
          this.decorators[version][decoratorId] = 'off';
        }
      }
    }
  }
}

export class Config {
  apis: Record<string, ResolvedApi>;
  styleguide: StyleguideConfig;
  resolve: ResolveConfig;
  licenseKey?: string;
  region?: Region;
  theme: ThemeRawConfig;
  organization?: string;
  files: string[];
  telemetry?: Telemetry;
  constructor(public rawConfig: ResolvedConfig, public configFile?: string) {
    this.apis = rawConfig.apis || {};
    this.styleguide = new StyleguideConfig(rawConfig.styleguide || {}, configFile);
    this.theme = rawConfig.theme || {};
    this.resolve = getResolveConfig(rawConfig?.resolve);
    this.region = rawConfig.region;
    this.organization = rawConfig.organization;
    this.files = rawConfig.files || [];
    this.telemetry = rawConfig.telemetry;
  }
}
