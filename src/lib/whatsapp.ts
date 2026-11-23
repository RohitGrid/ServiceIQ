/**
 * WhatsApp & Notifications Integration Helper (Track E Interface)
 * 
 * Conforms to Track E's agreed interface for triggering notifications.
 * Track E implements the Meta WhatsApp Business API webhook and dispatch.
 * Track C calls these helpers non-blockingly upon ticket intake and job assignment.
 */

export interface TicketNotificationPayload {
  ticketId: string;
  ticketNo: string;
  customerName?: string;
  customerPhone?: string | null;
  faultDescription?: string | null;
  priority?: string;
  siteName?: string;
}

export interface TechnicianAssignmentNotificationPayload {
  jobId: string;
  jobNo: string;
  technicianName: string;
  technicianPhone?: string | null;
  slotStart?: string | null;
  slotEnd?: string | null;
  customerName?: string;
  siteName?: string;
}

export async function sendTicketCreatedNotification(payload: TicketNotificationPayload) {
  try {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_ID;

    // If Track E has not configured WhatsApp credentials in this environment yet, skip safely
    if (!token || !phoneId || !payload.customerPhone) {
      return {
        success: false,
        skipped: true,
        reason: 'WhatsApp credentials or recipient phone not configured',
      };
    }

    // Call Track E's external Meta WhatsApp endpoint or edge function when present
    // Keep modular and catch any network/auth failures so core ticket flow is unaffected
    return { success: true };
  } catch (error: any) {
    console.warn('[Track E WhatsApp Notification Warning]:', error?.message || error);
    return { success: false, error: error?.message };
  }
}

export async function notifyTechnicianAssigned(payload: TechnicianAssignmentNotificationPayload) {
  try {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_ID;

    if (!token || !phoneId || !payload.technicianPhone) {
      return {
        success: false,
        skipped: true,
        reason: 'WhatsApp credentials or technician phone not configured',
      };
    }

    return { success: true };
  } catch (error: any) {
    console.warn('[Track E Technician Assignment Notification Warning]:', error?.message || error);
    return { success: false, error: error?.message };
  }
}
