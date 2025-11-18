import { config } from '../config';
import { logger } from '../utils/logger';

interface AlertContext {
  [key: string]: string | number | boolean | undefined;
}

export class AlertService {
  static async notify(message: string, context?: AlertContext): Promise<void> {
    const webhookUrl = config.alerts?.webhookUrl;

    if (!webhookUrl) {
      return;
    }

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: message,
          context,
        }),
      });
    } catch (error) {
      logger.error('Failed to send alert notification:', error);
    }
  }
}
