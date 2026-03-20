import { Injectable } from '@nestjs/common';
import {
  REFERRAL_CODE_CHARSET,
  REFERRAL_CODE_LENGTH,
  REFERRAL_CODE_PREFIX,
} from './referral.constants';
import {
  ReferralCodeGenerateOptions,
  ReferralCodeGeneratorPort,
} from './types/referral-code-generator.types';

type ReferralCodesLib = {
  generate: (config: {
    length?: number;
    count?: number;
    charset?: string;
    prefix?: string;
    postfix?: string;
    pattern?: string;
  }) => string[];
};

@Injectable()
export class ReferralCodeGeneratorService implements ReferralCodeGeneratorPort {
  private static readonly dynamicImport = new Function(
    'modulePath',
    'return import(modulePath);',
  ) as (modulePath: string) => Promise<unknown>;

  async generate(options: ReferralCodeGenerateOptions): Promise<string[]> {
    const lib = await this.loadLibrary();
    const codes = lib.generate({
      count: options.count,
      length: REFERRAL_CODE_LENGTH,
      prefix: REFERRAL_CODE_PREFIX,
      charset: REFERRAL_CODE_CHARSET,
    });
    return codes.map((code) => code.toUpperCase());
  }

  private async loadLibrary(): Promise<ReferralCodesLib> {
    const mod = await ReferralCodeGeneratorService.dynamicImport('referral-codes');
    const lib = ((mod as { default?: unknown }).default ?? mod) as Partial<ReferralCodesLib>;
    if (!lib.generate) {
      throw new Error('Invalid referral-codes module: generate() not found');
    }
    return lib as ReferralCodesLib;
  }
}
