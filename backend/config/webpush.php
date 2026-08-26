<?php

return [
    // VAPID keys (base64url). The public key is safe to expose to the browser.
    'vapid' => [
        'subject' => env('VAPID_SUBJECT', 'mailto:admin@example.com'),
        'public_key' => env('VAPID_PUBLIC_KEY', ''),
        'private_key' => env('VAPID_PRIVATE_KEY', ''),
    ],

    // On Windows, EC (VAPID) signing needs an OpenSSL config file.
    'openssl_conf' => env('OPENSSL_CONF'),
];
