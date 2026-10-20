export default {
  test: {
    include: ['test/**/*.test.ts'],
    env: {
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
      AWS_REGION: 'ap-south-1',
      AWS_PROFILE: '',
      AWS_CONFIG_FILE: '/dev/null',
      AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
      AWS_EC2_METADATA_DISABLED: 'true',
    },
  },
};
