/**
 * Gmail service - stub version
 * Will be enabled when Google connector is configured
 */

export async function sendEmailVerificationCode(
  email: string,
  code: string,
  language: string = "ar"
): Promise<void> {
  console.log(`[Email] Would send verification code ${code} to ${email} (lang: ${language})`);
  // In development or without connector, just log the code
  console.log(`[Email Verification Code for ${email}]: ${code}`);
  // Don't throw - allow registration to proceed
}
