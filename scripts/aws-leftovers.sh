#!/usr/bin/env bash
set -uo pipefail

export AWS_PAGER=""
export MSYS_NO_PATHCONV=1
PREFIX="${LEAKTRACE_PREFIX:-leaktrace}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

run() {
  local out rc
  out="$(aws "$@" --output text 2>&1)"
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "__ERROR__"
    return 0
  fi
  [ "$out" = "None" ] && out=""
  printf '%s' "$out"
}

emit() {
  local file="$1" tag="$2" region="$3" kind="$4" items="$5"
  if [ "$items" = "__ERROR__" ]; then
    printf 'unchecked  %-14s %s\n' "$region" "$kind (no permission or call failed)" >> "$file.unchecked"
  elif [ -n "$items" ]; then
    printf '%s  %-14s %-20s %s\n' "$tag" "$region" "$kind" "$(echo "$items" | tr '\n\t' '  ')" >> "$file"
  fi
}

scan_region() {
  local r="$1" f="$WORK/$1"
  : > "$f"
  emit "$f" LEFTOVER "$r" ec2-instances "$(run ec2 describe-instances --region "$r" --filters "Name=tag:Name,Values=${PREFIX}*" "Name=instance-state-name,Values=pending,running,stopping,stopped" --query 'Reservations[].Instances[].InstanceId')"
  emit "$f" LEFTOVER "$r" ec2-tagged "$(run ec2 describe-instances --region "$r" --filters "Name=tag:Project,Values=${PREFIX}" "Name=instance-state-name,Values=pending,running,stopping,stopped" --query 'Reservations[].Instances[].InstanceId')"
  emit "$f" LEFTOVER "$r" ebs-volumes "$(run ec2 describe-volumes --region "$r" --filters "Name=tag:Project,Values=${PREFIX}" --query 'Volumes[].VolumeId')"
  emit "$f" LEFTOVER "$r" ebs-snapshots "$(run ec2 describe-snapshots --region "$r" --owner-ids self --filters "Name=tag:Project,Values=${PREFIX}" --query 'Snapshots[].SnapshotId')"
  emit "$f" LEFTOVER "$r" amis "$(run ec2 describe-images --region "$r" --owners self --filters "Name=tag:Project,Values=${PREFIX}" --query 'Images[].ImageId')"
  emit "$f" LEFTOVER "$r" launch-templates "$(run ec2 describe-launch-templates --region "$r" --query "LaunchTemplates[?starts_with(LaunchTemplateName, \`${PREFIX}\`)].LaunchTemplateName")"
  emit "$f" LEFTOVER "$r" auto-scaling-groups "$(run autoscaling describe-auto-scaling-groups --region "$r" --query "AutoScalingGroups[?starts_with(AutoScalingGroupName, \`${PREFIX}\`)].AutoScalingGroupName")"
  emit "$f" LEFTOVER "$r" vpcs "$(run ec2 describe-vpcs --region "$r" --filters "Name=tag:Name,Values=${PREFIX}*" --query 'Vpcs[].VpcId')"
  emit "$f" LEFTOVER "$r" security-groups "$(run ec2 describe-security-groups --region "$r" --filters "Name=group-name,Values=${PREFIX}*" --query 'SecurityGroups[].GroupId')"
  emit "$f" LEFTOVER "$r" rds-instances "$(run rds describe-db-instances --region "$r" --query "DBInstances[?starts_with(DBInstanceIdentifier, \`${PREFIX}\`)].DBInstanceIdentifier")"
  emit "$f" LEFTOVER "$r" rds-snapshots "$(run rds describe-db-snapshots --region "$r" --query "DBSnapshots[?starts_with(DBInstanceIdentifier, \`${PREFIX}\`)].DBSnapshotIdentifier")"
  emit "$f" LEFTOVER "$r" sqs-queues "$(run sqs list-queues --region "$r" --queue-name-prefix "$PREFIX" --query 'QueueUrls[]')"
  emit "$f" LEFTOVER "$r" sns-topics "$(run sns list-topics --region "$r" --query "Topics[?contains(TopicArn, \`${PREFIX}\`)].TopicArn")"
  emit "$f" LEFTOVER "$r" scheduler-groups "$(run scheduler list-schedule-groups --region "$r" --name-prefix "$PREFIX" --query 'ScheduleGroups[].Name')"
  emit "$f" LEFTOVER "$r" ssm-parameters "$(run ssm get-parameters-by-path --region "$r" --path "/${PREFIX}" --recursive --query 'Parameters[].Name')"
  emit "$f" LEFTOVER "$r" cloudwatch-alarms "$(run cloudwatch describe-alarms --region "$r" --alarm-name-prefix "$PREFIX" --query 'MetricAlarms[].AlarmName')"
  emit "$f" LEFTOVER "$r" log-groups "$(run logs describe-log-groups --region "$r" --log-group-name-prefix "/${PREFIX}" --query 'logGroups[].logGroupName')"
  emit "$f" "not-${PREFIX}" "$r" elastic-ips "$(run ec2 describe-addresses --region "$r" --query 'Addresses[].AllocationId')"
  emit "$f" "not-${PREFIX}" "$r" nat-gateways "$(run ec2 describe-nat-gateways --region "$r" --filter Name=state,Values=available,pending --query 'NatGateways[].NatGatewayId')"
  emit "$f" "not-${PREFIX}" "$r" load-balancers "$(run elbv2 describe-load-balancers --region "$r" --query 'LoadBalancers[].LoadBalancerName')"
  emit "$f" "not-${PREFIX}" "$r" other-rds "$(run rds describe-db-instances --region "$r" --query "DBInstances[?!starts_with(DBInstanceIdentifier, \`${PREFIX}\`)].DBInstanceIdentifier")"
}

regions="$(aws ec2 describe-regions --query 'Regions[].RegionName' --output text 2>/dev/null)"
if [ -z "$regions" ]; then
  echo "Could not list regions. Check your AWS credentials (this script only reads)." >&2
  exit 2
fi

for r in $regions; do
  scan_region "$r" &
done

G="$WORK/global"
: > "$G"
emit "$G" LEFTOVER global s3-buckets "$(run s3api list-buckets --query "Buckets[?starts_with(Name, \`${PREFIX}\`)].Name")"
emit "$G" LEFTOVER global iam-roles "$(run iam list-roles --query "Roles[?starts_with(RoleName, \`${PREFIX}\`)].RoleName")"
emit "$G" LEFTOVER global instance-profiles "$(run iam list-instance-profiles --query "InstanceProfiles[?starts_with(InstanceProfileName, \`${PREFIX}\`)].InstanceProfileName")"
wait

found=0
other=0
unchecked=0
for f in "$G" $(for r in $regions; do echo "$WORK/$r"; done); do
  [ -s "$f" ] && cat "$f"
  grep -q '^LEFTOVER' "$f" 2>/dev/null && found=1
  grep -q "^not-${PREFIX}" "$f" 2>/dev/null && other=1
  if [ -s "$f.unchecked" ]; then
    unchecked=1
  fi
done

if [ "$unchecked" -eq 1 ]; then
  echo
  echo "Could not check (permission denied or call failed). These do not count as clean:"
  cat "$WORK"/*.unchecked 2>/dev/null | sort -u
fi

echo
if [ "$found" -eq 1 ]; then
  echo "Some ${PREFIX} resources are still there. See docs/aws/TEARDOWN.md."
  [ "$other" -eq 1 ] && echo "Lines starting with 'not-${PREFIX}' belong to other projects. Do not delete them as part of this teardown."
  exit 1
fi

echo "No ${PREFIX} resources found in the places that could be checked."
[ "$other" -eq 1 ] && echo "Lines starting with 'not-${PREFIX}' belong to other projects and may still bill. They are not part of this teardown."
[ "$unchecked" -eq 1 ] && exit 3
exit 0
