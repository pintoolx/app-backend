export type ReferralCodeGenerateOptions = {
  count: number;
};

export interface ReferralCodeGeneratorPort {
  generate(options: ReferralCodeGenerateOptions): Promise<string[]>;
}
