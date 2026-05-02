/**
 * File Purpose: frontend/src/app/models/smtp.model.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

export interface SmtpConfig {
  _id?: string;
  provider: SmtpProvider;
  authMethod: 'credentials';
  username: string;
  host: string;
  port: number;
  useTLS: boolean;
  clientHostname?: string;
  senderName: string;
  senderEmail: string;
  recipients: string[];
  sendOnlyIfRed: boolean;
  isActive: boolean;
  lastTestDate?: Date;
  lastTestSuccess?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type SmtpProvider = 
  | 'office365'
  | 'aws-ses'
  | 'elastic-email'
  | 'google-mail'
  | 'google-workspace'
  | 'mailgun'
  | 'custom';

export interface SmtpConfigRequest extends SmtpConfig {
  password?: string;
}

export interface SmtpTestResponse {
  message: string;
  recipient: string;
}
