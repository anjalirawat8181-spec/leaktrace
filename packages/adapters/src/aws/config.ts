import { GetParametersByPathCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { Config } from '../interfaces';

export class SsmConfig implements Config {
  private constructor(private readonly values: Record<string, string>) {}

  static async load(region: string, path: string): Promise<SsmConfig> {
    const client = new SSMClient({ region });
    const values: Record<string, string> = {};
    let nextToken: string | undefined;
    do {
      const res = await client.send(new GetParametersByPathCommand({
        Path: path,
        Recursive: true,
        WithDecryption: true,
        NextToken: nextToken,
      }));
      for (const p of res.Parameters ?? []) {
        if (!p.Name || p.Value === undefined) continue;
        const key = p.Name.split('/').pop();
        if (key) values[key] = p.Value;
      }
      nextToken = res.NextToken;
    } while (nextToken);
    return new SsmConfig(values);
  }

  get(key: string): string | undefined {
    return this.values[key];
  }
}
