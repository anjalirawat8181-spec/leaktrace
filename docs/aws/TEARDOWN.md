# AWS teardown checklist

For Pranav, who owns the account. Everything below is done by hand; nothing in this repository deletes anything. The live demo no longer needs AWS: it runs on the free stack (see `infra/free/README.md`).

**Cost while it is up:** about $0.75 a day (about ₹66). The two big items are the database (`db.t4g.micro`, $0.43 a day with its storage) and the API server ($0.31 a day with its address and volume). Details: `docs/aws/inventory.md`.

**Before you start**

- Only delete things named `leaktrace-*` (or the IDs written below). The account also holds other projects: the database `ccl-lab-5` and an Elastic IP in `eu-north-1`, the buckets `10610-pranavkoradiya`, `ccl-test-bucket-*`, `crce-tag-ingestion-pranav` and `pranavkoradiya-resume`, the roles `CampusLostFoundEC2Role`, `PL12-FlowLogs-Role`, `rds-monitoring-role`, `ReservationConfirmationRole` and `ReservationProcessorRole`, and the default VPC. Leave all of them alone.
- Nothing here needs the old data. The database holds only demo exams, and the PDFs are demo papers. If you want to keep a copy of the database anyway, see step 4.
- Account ID is written as `<ACCOUNT_ID>`. Put your own in. All commands use `--region ap-south-1`.
- Do the steps in order. Each one lists the click path, the command, and a command that proves it is gone.
- Keep the read-only `anjali-readonly` user until the very end (step 13): it is what the verification commands and `scripts/aws-leftovers.sh` run as.

---

## 1. Auto Scaling group and launch template

The group is already at 0 instances, but it owns the scaling policies and keeps the launch template in use.

**Console:** EC2 → Auto Scaling Groups → `leaktrace-workers` → Delete → type `delete`. Then EC2 → Launch Templates → `leaktrace-worker-lt` → Actions → Delete template.

```
aws autoscaling update-auto-scaling-group --auto-scaling-group-name leaktrace-workers --min-size 0 --desired-capacity 0 --region ap-south-1
aws autoscaling delete-auto-scaling-group --auto-scaling-group-name leaktrace-workers --force-delete --region ap-south-1
aws ec2 delete-launch-template --launch-template-name leaktrace-worker-lt --region ap-south-1
```

**Verify:** both commands return nothing for these names.

```
aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names leaktrace-workers --region ap-south-1 --query 'AutoScalingGroups'
aws ec2 describe-launch-templates --region ap-south-1 --query 'LaunchTemplates[?starts_with(LaunchTemplateName, `leaktrace`)]'
```

Expect `[]` for both.

## 2. EventBridge schedules and group

Two `leaktrace-close-<exam id>` schedules are waiting (they delete themselves after they fire, but they have not fired yet). The group cannot be deleted while it has schedules.

**Console:** EventBridge → Scheduler → Schedule groups → `leaktrace` → select each schedule → Delete; then delete the group.

```
aws scheduler list-schedules --group-name leaktrace --region ap-south-1 --query 'Schedules[].Name' --output text
aws scheduler delete-schedule --group-name leaktrace --name <name from the list> --region ap-south-1
aws scheduler delete-schedule-group --name leaktrace --region ap-south-1
```

Repeat `delete-schedule` for every name the list prints.

**Verify:** `aws scheduler list-schedule-groups --region ap-south-1 --query 'ScheduleGroups[].Name'` shows only `default`.

## 3. API server (EC2)

Instance `i-090080767784a1d40` (`leaktrace-api`). Its 16 GB volume is set to delete with it, and its public address is released when it stops.

**Console:** EC2 → Instances → `leaktrace-api` → Instance state → Terminate instance.

```
aws ec2 terminate-instances --instance-ids i-090080767784a1d40 --region ap-south-1
aws ec2 wait instance-terminated --instance-ids i-090080767784a1d40 --region ap-south-1
```

**Verify:** `aws ec2 describe-instances --instance-ids i-090080767784a1d40 --region ap-south-1 --query 'Reservations[].Instances[].State.Name'` prints `terminated`.

## 4. Database (RDS)

`leaktrace-db` has **deletion protection turned on**, so the delete fails until you switch it off.

**Final snapshot: not needed.** The database holds only demo exams. A snapshot of a 20 GB database is billed per GB-month until you delete it (at most 20 GB, a few dollars a month at typical rates; check the RDS pricing page). If you do want a copy, take one snapshot first (`aws rds create-db-snapshot --db-instance-identifier leaktrace-db --db-snapshot-identifier leaktrace-db-final`), and also save the `/leaktrace/prod/FINGERPRINT_KEY` value from step 8 before you delete it: without that key the stored copies cannot be matched to a leak.

**Console:** RDS → Databases → `leaktrace-db` → Modify → untick "Enable deletion protection" → Continue → "Apply immediately" → Modify DB instance. Then Actions → Delete → untick "Create final snapshot" and "Retain automated backups" → type `delete me` → Delete.

```
aws rds modify-db-instance --db-instance-identifier leaktrace-db --no-deletion-protection --apply-immediately --region ap-south-1
aws rds delete-db-instance --db-instance-identifier leaktrace-db --skip-final-snapshot --delete-automated-backups --region ap-south-1
aws rds wait db-instance-deleted --db-instance-identifier leaktrace-db --region ap-south-1
aws rds delete-db-subnet-group --db-subnet-group-name leaktrace-db-subnets --region ap-south-1
```

The three automated snapshots (`rds:leaktrace-db-2026-11-08...` to `-10...`) go with the instance because of `--delete-automated-backups`.

**Verify:**

```
aws rds describe-db-instances --region ap-south-1 --query 'DBInstances[?starts_with(DBInstanceIdentifier, `leaktrace`)]'
aws rds describe-db-snapshots --region ap-south-1 --query 'DBSnapshots[?starts_with(DBInstanceIdentifier, `leaktrace`)]'
```

Expect `[]` for both. (`ccl-lab-5` is in `eu-north-1` and is not part of this.)

## 5. Elastic IPs, leftover volumes, snapshots and images

The inventory found none of these in `ap-south-1`, but check after the instance is gone.

**Console:** EC2 → Elastic IPs (release any unattached one that is yours), Volumes (state "available" = unattached), Snapshots (Owned by me), AMIs (Owned by me).

```
aws ec2 describe-addresses --region ap-south-1 --query 'Addresses[].[AllocationId,AssociationId]'
aws ec2 describe-volumes --region ap-south-1 --query 'Volumes[?State==`available`].[VolumeId,Size]'
aws ec2 describe-snapshots --owner-ids self --region ap-south-1 --query 'Snapshots[].SnapshotId'
aws ec2 describe-images --owners self --region ap-south-1 --query 'Images[].ImageId'
```

Expect `[]` for all four. Do not release the Elastic IP in `eu-north-1`; it belongs to `ccl-lab-5`.

## 6. S3 buckets

Three buckets: `leaktrace-data-ccl2026` (**versioned**), `leaktrace-deploy-ccl2026`, `leaktrace-web-ccl2026`. A bucket must be completely empty, including old versions and delete markers, before it can be deleted.

**Console:** S3 → select the bucket → Empty → type `permanently delete` → Empty. Then Delete bucket (type the name). The console's Empty removes all versions.

```
for B in leaktrace-data-ccl2026 leaktrace-deploy-ccl2026 leaktrace-web-ccl2026; do
  aws s3 rm s3://$B --recursive --region ap-south-1
  aws s3api delete-objects --bucket $B --region ap-south-1 --delete "$(aws s3api list-object-versions --bucket $B --region ap-south-1 --output json --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}')" 2>/dev/null
  aws s3api delete-objects --bucket $B --region ap-south-1 --delete "$(aws s3api list-object-versions --bucket $B --region ap-south-1 --output json --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}')" 2>/dev/null
  aws s3api delete-bucket --bucket $B --region ap-south-1
done
```

The `delete-objects` lines print an error when there is nothing to delete; that is fine. The buckets hold 36 objects (6.2 MB), so one pass is enough.

**Verify:** `aws s3api list-buckets --query 'Buckets[?starts_with(Name, `leaktrace`)]'` prints `[]`.

## 7. SQS queues and SNS topics

**Console:** SQS → select a queue → Delete → type `delete`. SNS → Topics → select → Delete → type `delete me` (its two email subscriptions go with it).

```
for Q in leaktrace-generation leaktrace-generation-dlq leaktrace-exam-events; do
  aws sqs delete-queue --queue-url https://sqs.ap-south-1.amazonaws.com/<ACCOUNT_ID>/$Q --region ap-south-1
done
for T in leaktrace-leak-alerts leaktrace-ops-alerts leaktrace-release-notices; do
  aws sns delete-topic --topic-arn arn:aws:sns:ap-south-1:<ACCOUNT_ID>:$T --region ap-south-1
done
```

SQS takes up to 60 seconds to finish a delete.

**Verify:** `aws sqs list-queues --region ap-south-1 --queue-name-prefix leaktrace` prints nothing; `aws sns list-topics --region ap-south-1 --query 'Topics[?contains(TopicArn, `leaktrace`)]'` prints `[]`.

## 8. SSM parameters

Sixteen parameters under `/leaktrace/prod/`. The four `SecureString` ones are the database passwords, `JWT_SECRET` and `FINGERPRINT_KEY` (see the note in step 4 before deleting that last one).

**Console:** Systems Manager → Parameter Store → search `/leaktrace/prod` → select all → Delete.

```
aws ssm delete-parameters --region ap-south-1 --names /leaktrace/prod/DATA_BUCKET /leaktrace/prod/DB_ADMIN_PASSWORD /leaktrace/prod/DB_NAME /leaktrace/prod/DB_PASSWORD /leaktrace/prod/EXAM_EVENTS_QUEUE_ARN /leaktrace/prod/EXAM_EVENTS_QUEUE_URL /leaktrace/prod/GENERATION_QUEUE_URL /leaktrace/prod/OPS_ALERTS_TOPIC_ARN /leaktrace/prod/RELEASE_NOTICES_TOPIC_ARN /leaktrace/prod/SCHEDULER_ROLE_ARN
aws ssm delete-parameters --region ap-south-1 --names /leaktrace/prod/DB_HOST /leaktrace/prod/DB_USER /leaktrace/prod/FINGERPRINT_KEY /leaktrace/prod/JWT_SECRET /leaktrace/prod/LEAK_ALERTS_TOPIC_ARN /leaktrace/prod/WORKER_ASG_NAME
```

**Verify:** `aws ssm get-parameters-by-path --path /leaktrace --recursive --region ap-south-1 --query 'Parameters[].Name'` prints `[]`.

## 9. IAM roles, policies and instance profiles

Three roles: `leaktrace-api-role`, `leaktrace-worker-role`, `leaktrace-scheduler-role`; two instance profiles with the same names as the first two. Delete the profiles before the roles, and the policies before the roles.

**Console:** IAM → Roles → `leaktrace-api-role` → Permissions tab: delete each inline policy (`leaktrace-api-policy`, `scheduler-access`, `web-bucket-read`) and remove the two AWS-managed policies (`CloudWatchAgentServerPolicy`, `AmazonSSMManagedInstanceCore`) → Delete role. Repeat for `leaktrace-worker-role` (inline `leaktrace-worker-policy`, same two managed) and `leaktrace-scheduler-role` (inline `leaktrace-scheduler-policy`). The IAM console has no page for instance profiles, so delete the two profiles with the CLI commands below (or with `aws iam delete-instance-profile`).

```
for R in leaktrace-api-role leaktrace-worker-role; do
  aws iam remove-role-from-instance-profile --instance-profile-name $R --role-name $R
  aws iam delete-instance-profile --instance-profile-name $R
  aws iam detach-role-policy --role-name $R --policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy
  aws iam detach-role-policy --role-name $R --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
done
aws iam delete-role-policy --role-name leaktrace-api-role --policy-name leaktrace-api-policy
aws iam delete-role-policy --role-name leaktrace-api-role --policy-name scheduler-access
aws iam delete-role-policy --role-name leaktrace-api-role --policy-name web-bucket-read
aws iam delete-role-policy --role-name leaktrace-worker-role --policy-name leaktrace-worker-policy
aws iam delete-role-policy --role-name leaktrace-scheduler-role --policy-name leaktrace-scheduler-policy
for R in leaktrace-api-role leaktrace-worker-role leaktrace-scheduler-role; do aws iam delete-role --role-name $R; done
```

**Verify:** `aws iam list-roles --query 'Roles[?starts_with(RoleName, `leaktrace`)].RoleName'` prints `[]`; `aws iam list-instance-profiles --query 'InstanceProfiles[?starts_with(InstanceProfileName, `leaktrace`)]'` prints `[]`.

## 10. Security groups and the network

The VPC `leaktrace-vpc` (`vpc-034cf1a66b4711c37`) is the only one to delete. **Do not touch the default VPC `vpc-0e6f652568fe4cbbb`.** Delete in this order: the database group first (it refers to the other two), then the rest.

**Console:** VPC → Security groups → delete `leaktrace-db-sg`, then `leaktrace-api-sg`, then `leaktrace-worker-sg`. VPC → Endpoints → delete the S3 endpoint. Then VPC → Your VPCs → `leaktrace-vpc` → Actions → Delete VPC; it also deletes the subnets, route tables and internet gateway after a confirmation.

```
aws ec2 delete-security-group --group-id sg-05fb3dab1b31b608f --region ap-south-1
aws ec2 delete-security-group --group-id sg-052263279fa4cb094 --region ap-south-1
aws ec2 delete-security-group --group-id sg-094953c16c9711044 --region ap-south-1
aws ec2 delete-vpc-endpoints --vpc-endpoint-ids vpce-0c22b42db43aec458 --region ap-south-1
for S in subnet-05fc36c97ec2b7f1a subnet-01f7b3003c22f8c5d subnet-0a8a09e8537d13441 subnet-0cdd5f9be7803d12b; do aws ec2 delete-subnet --subnet-id $S --region ap-south-1; done
for RT in rtb-0cee001008af44d9c rtb-092be4fa0accff38c rtb-00f3f795f367f5c76; do aws ec2 delete-route-table --route-table-id $RT --region ap-south-1; done
aws ec2 detach-internet-gateway --internet-gateway-id igw-0f31deced5eb70f9e --vpc-id vpc-034cf1a66b4711c37 --region ap-south-1
aws ec2 delete-internet-gateway --internet-gateway-id igw-0f31deced5eb70f9e --region ap-south-1
aws ec2 delete-vpc --vpc-id vpc-034cf1a66b4711c37 --region ap-south-1
```

If a delete says "has dependencies", something is still using it: an instance or database that is not fully gone yet (steps 3 and 4), or an interface left by the database. Wait a few minutes and retry.

**Verify:** `aws ec2 describe-vpcs --region ap-south-1 --query 'Vpcs[].VpcId'` lists only `vpc-0e6f652568fe4cbbb`.

## 11. CloudWatch alarms and log groups

Three alarms: `leaktrace-queue-has-work`, `leaktrace-queue-empty` (it shows ALARM when the queue is empty, which is normal), `leaktrace-dlq-not-empty`. There are no log groups.

**Console:** CloudWatch → Alarms → select the three → Actions → Delete.

```
aws cloudwatch delete-alarms --alarm-names leaktrace-queue-has-work leaktrace-queue-empty leaktrace-dlq-not-empty --region ap-south-1
```

**Verify:** `aws cloudwatch describe-alarms --alarm-name-prefix leaktrace --region ap-south-1 --query 'MetricAlarms'` prints `[]`; `aws logs describe-log-groups --log-group-name-prefix /leaktrace --region ap-south-1 --query 'logGroups'` prints `[]`.

## 12. Check the other regions

From the repository, with the read-only user still active:

```
AWS_PROFILE=anjali-readonly scripts/aws-leftovers.sh
```

It takes about a minute and a half, only reads, and lists anything named `leaktrace` or tagged `Project=leaktrace` in every region plus the global S3 and IAM items. Exit code 0 means clean, 1 means something is left, 2 means no credentials, 3 means everything it could check was clean but some checks were denied (it lists which). It also prints, separately and labelled "not LeakTrace", other billable things in the account such as `ccl-lab-5`; those are not yours to delete here.

**Console version:** switch the region selector through each region you ever used and look at EC2 (instances, volumes, Elastic IPs), RDS, and S3 (global). Billing → Bills → "Charges by service" shows which regions still bill.

## 13. Delete the `anjali-readonly` IAM user (last)

Only after step 12 prints nothing for LeakTrace. Anyone holding its access key (it is saved in `.env.deploy` on Anjali's laptop) loses access at once.

**Console:** IAM → Users → `anjali-readonly` → Security credentials → delete the access key → Delete user.

```
aws iam list-access-keys --user-name anjali-readonly
aws iam delete-access-key --user-name anjali-readonly --access-key-id <key id from the list>
aws iam list-attached-user-policies --user-name anjali-readonly
aws iam detach-user-policy --user-name anjali-readonly --policy-arn <arn from the list>
aws iam list-user-policies --user-name anjali-readonly
aws iam delete-user --user-name anjali-readonly
```

Run `detach-user-policy` and `delete-user-policy` for each policy the two list commands print; the user cannot be deleted while it has any.

Also remove the `anjali-readonly` profile from Anjali's `~/.aws/credentials` and delete `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from `.env.deploy`.

---

## Check the bill the next day

Cost Explorer lags by about a day.

**Console:** Billing → Cost Explorer → Daily → Group by Service → set the range to the day after the teardown. EC2, RDS, VPC (public IPv4) and CloudWatch should show $0 for `ap-south-1`.

```
aws ce get-cost-and-usage --time-period Start=<yesterday>,End=<today> --granularity DAILY --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE --region us-east-1
```

Anything still above zero for `ap-south-1` means something was missed; run `scripts/aws-leftovers.sh` again before the user is deleted, or look at Billing → Bills → the service → the region.

## Set a ₹100 budget alert

AWS Budgets are set in US dollars: **$1.15 is about ₹100** at ₹88 to the dollar.

**Console:** Billing → Budgets → Create budget → Customize → Cost budget → Monthly, fixed amount `1.15` → Add an alert threshold of 100% of the budgeted amount (actual) → add your email → Create budget.

The account already has a budget called `My Zero-Spend Budget` with a $1.00 limit. It is not part of LeakTrace; leave it.

```
aws budgets create-budget --account-id <ACCOUNT_ID> --budget '{"BudgetName":"monthly-100-rupees","BudgetLimit":{"Amount":"1.15","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}' --notifications-with-subscribers '[{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":100,"ThresholdType":"PERCENTAGE"},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"<your email>"}]}]'
```

---

## Free stack: limits and keys

The live demo runs on Vercel (web), Render (API and worker), Neon (database) and Cloudflare R2 (files). Full detail: `infra/free/README.md`.

**Limits**

| Service | Limit that matters | What happens |
|---|---|---|
| Render Free | sleeps after 15 minutes without traffic, 750 instance hours a month, 512 MB | first visit after a sleep takes about a minute; the keep-warm job pings it during the day |
| Neon Free | small storage, monthly compute-hour allowance, autosuspend | the app stops polling the database when idle to stay inside it |
| Cloudflare R2 | free storage and request allowance | the nightly reset empties demo files |
| Vercel Hobby | personal-use terms, bandwidth cap | fine for a demo |
| GitHub Actions | free for public repositories | runs CI, the nightly reset and the keep-warm ping |

Allowances change; check each vendor's pricing page.

**Keys that can be revoked after deployment without breaking the live site**

| Key | Where it lives | Revoke? | What stops working |
|---|---|---|---|
| Render API key | `.env.deploy` only | yes | `scripts/deploy-free.sh` (creating or updating the Render service). The running service is unaffected |
| Vercel token | `.env.deploy` and the GitHub secret `VERCEL_TOKEN` | yes | the `deploy-web` workflow and `deploy-free.sh vercel`. The deployed site stays up |
| The read-only AWS key | `.env.deploy` | yes, with the user in step 13 | nothing in the live demo |

**Values that must stay**

| Value | Where | Why |
|---|---|---|
| Neon connection strings | Render environment (`DATABASE_URL`, `DATABASE_DIRECT_URL`) | the API reads and writes the database with them |
| R2 access keys and bucket name | Render environment (`R2_*`) | the API stores and signs links for PDFs with them |
| `JWT_SECRET` | Render environment | signs sessions; changing it signs everyone out |
| `FINGERPRINT_KEY` | Render environment | **never change it**: stored copies are recomputed from it, so a new key breaks leak tracing for every existing exam |
| `DEMO_RESET_TOKEN` | Render environment and the GitHub secret of the same name | the nightly reset workflow uses it |
| `API_URL` | GitHub repository variable | the nightly reset and keep-warm workflows call it |
| R2 CORS rule | Cloudflare dashboard | lets the browser upload evidence photos |

Keep a private copy of `.env.deploy` (without the AWS lines once step 13 is done) somewhere safe: it is the only place where the generated secrets are all written together.
