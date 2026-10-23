import { v4 as uuidv4 } from 'uuid';
import { generateWebhookSignature } from '../services/paymentService';
import { config } from '../config';

async function main() {
  const args = process.argv.slice(2);
  let orderId = args[0];
  let amountPaiseArg = args[1];
  let statusArg = args[2] || 'captured';
  let eventIdArg = args[3] || `evt_${uuidv4().substring(0, 8)}`;

  for (const arg of args) {
    if (arg.startsWith('--orderId=')) orderId = arg.split('=')[1];
    if (arg.startsWith('--amount=')) amountPaiseArg = arg.split('=')[1];
    if (arg.startsWith('--status=')) statusArg = arg.split('=')[1];
    if (arg.startsWith('--eventId=')) eventIdArg = arg.split('=')[1];
  }

  if (!orderId) {
    console.error('Usage: npm run send-webhook -- <orderId> [amountPaise] [status] [eventId]');
    process.exit(1);
  }

  let amountPaise: number;
  const baseUrl = `http://localhost:${config.port}`;

  if (!amountPaiseArg) {
    try {
      const res = await fetch(`${baseUrl}/orders/${orderId}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch order: HTTP ${res.status}`);
      }
      const data = await res.json();
      amountPaise = data.totalPaise;
      console.log(`Fetched order total from server: ${amountPaise} paise`);
    } catch (err) {
      console.error('Could not auto-fetch order total. Please specify amount in paise as second argument.');
      process.exit(1);
    }
  } else {
    amountPaise = parseInt(amountPaiseArg, 10);
  }

  const payload = {
    eventId: eventIdArg,
    orderId,
    amountPaise,
    status: statusArg
  };

  const rawBody = JSON.stringify(payload);
  const signature = generateWebhookSignature(rawBody);

  console.log(`Sending webhook to ${baseUrl}/payments/webhook`);
  console.log('Payload:', payload);
  console.log('X-Signature:', signature);

  const response = await fetch(`${baseUrl}/payments/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature': signature
    },
    body: rawBody
  });

  const responseBody = await response.text();
  console.log(`Response Status: ${response.status}`);
  console.log(`Response Body: ${responseBody}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
