// This helper used to send emails directly via AWS SES.
// Email delivery is now handled by the dedicated Lambda `sendPassword`.
// Keeping a thin function here in case other parts of the code import it.

export async function sendPasswordEmail({ to, eventTitle, password }) {
  console.log(
    "[sendPasswordEmail] invoked with:",
    JSON.stringify({ to, eventTitle, password: password ? "***redacted***" : null })
  );

  // No-op in this service. Email is sent by the AWS Lambda.
  return { success: true, delegatedToLambda: true };
}
