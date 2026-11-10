#!/bin/bash
set -e

# Create Dead Letter Queue (DLQ)
awslocal sqs create-queue \
    --queue-name wager-transactions-dlq.fifo \
    --attributes FifoQueue=true,ContentBasedDeduplication=true

# Get DLQ ARN
DLQ_ARN=$(awslocal sqs get-queue-attributes \
    --queue-url http://localhost:4566/000000000000/wager-transactions-dlq.fifo \
    --attribute-names QueueArn \
    --query 'Attributes.QueueArn' \
    --output text)

# Create Main Queue with RedrivePolicy pointing to DLQ
awslocal sqs create-queue \
    --queue-name wager-transactions.fifo \
    --attributes "FifoQueue=true,ContentBasedDeduplication=true,RedrivePolicy={\"maxReceiveCount\":\"5\",\"deadLetterTargetArn\":\"$DLQ_ARN\"}"

echo "SQS Queues initialized with DLQ RedrivePolicy."
