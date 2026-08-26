<?php

namespace Database\Seeders;

use App\Models\SystemSetting;
use Illuminate\Database\Seeder;

class SystemSettingSeeder extends Seeder
{
    public function run(): void
    {
        $settings = [
            ['key' => 'alert_insurance_days', 'value' => '30', 'type' => 'integer', 'group' => 'alerts', 'label' => 'Insurance expiry warning (days)'],
            ['key' => 'alert_roadworthy_days', 'value' => '30', 'type' => 'integer', 'group' => 'alerts', 'label' => 'Roadworthy expiry warning (days)'],
            ['key' => 'alert_licence_days', 'value' => '30', 'type' => 'integer', 'group' => 'alerts', 'label' => 'Licence expiry warning (days)'],
            ['key' => 'alert_service_days', 'value' => '30', 'type' => 'integer', 'group' => 'alerts', 'label' => 'Service due warning (days)'],
            ['key' => 'organisation_name', 'value' => 'University Information Technology Services', 'type' => 'string', 'group' => 'general', 'label' => 'Organisation name'],

            // Feature flags (spec §II-8) — default off for integration-dependent features.
            ['key' => 'feature_email_notifications', 'value' => '1', 'type' => 'boolean', 'group' => 'features', 'label' => 'Email notifications'],
            ['key' => 'feature_push_notifications', 'value' => '1', 'type' => 'boolean', 'group' => 'features', 'label' => 'Push notifications'],
            ['key' => 'feature_sms_notifications', 'value' => '0', 'type' => 'boolean', 'group' => 'features', 'label' => 'SMS notifications'],
            ['key' => 'feature_public_calendar', 'value' => '0', 'type' => 'boolean', 'group' => 'features', 'label' => 'Public calendar'],
            ['key' => 'feature_maintenance_attachments', 'value' => '0', 'type' => 'boolean', 'group' => 'features', 'label' => 'Maintenance attachments'],

            // Notification prefixes/toggles.
            ['key' => 'notif_email_subject_prefix', 'value' => '[UITS VMTL] ', 'type' => 'string', 'group' => 'notifications', 'label' => 'Email subject prefix'],
            ['key' => 'notif_sms_sender_prefix', 'value' => 'UITS', 'type' => 'string', 'group' => 'notifications', 'label' => 'SMS sender prefix'],
            ['key' => 'notif_allow_email', 'value' => '1', 'type' => 'boolean', 'group' => 'notifications', 'label' => 'Allow email'],
            ['key' => 'notif_allow_sms', 'value' => '0', 'type' => 'boolean', 'group' => 'notifications', 'label' => 'Allow SMS'],

            // Retention (0 = keep forever).
            ['key' => 'retain_audit_days', 'value' => '0', 'type' => 'integer', 'group' => 'retention', 'label' => 'Audit log retention (days)'],
            ['key' => 'retain_notification_days', 'value' => '90', 'type' => 'integer', 'group' => 'retention', 'label' => 'Notification retention (days)'],

            // Maintenance mode.
            ['key' => 'maintenance_mode', 'value' => '0', 'type' => 'boolean', 'group' => 'maintenance', 'label' => 'Maintenance mode'],
            ['key' => 'maintenance_message', 'value' => 'The system is undergoing scheduled maintenance.', 'type' => 'string', 'group' => 'maintenance', 'label' => 'Maintenance announcement'],
        ];

        foreach ($settings as $s) {
            SystemSetting::updateOrCreate(['key' => $s['key']], $s);
        }
    }
}
