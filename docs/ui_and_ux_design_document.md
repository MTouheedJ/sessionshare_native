# UI/UX & Interaction Design Specification

## 1. Web Dashboard (Admin Panel)

### Layout Blueprint
* **Sidebar Navigation**:
  * Dashboard Overview (Active Users, System Health)
  * Token Management (Generate, Pause, Revoke, Delete Tokens)
  * Session Monitor (Live connection graphs, IP logs, forced disconnect)
  * Vault Configuration (Owner pre-auth session state details)
  * Settings

### Key Components & UX Rules
1. **Token Creator Drawer**:
   * Options: Expiry Date/Time, Maximum Device Binding (Default: 1), Token Notes/Label.
   * Action: Generates a masked cryptographic string with a "Copy Token" button.
2. **Real-time User Action Matrix**:
   * Each user row displays: `Token Label`, `Assigned HWID`, `Status Badge (Active/Paused/Revoked/Offline)`, `Last Heartbeat`, and an `Actions Menu`.
   * **Action Buttons**:
     * **Pause Button**: Immediately toggles user session state to `PAUSED`. Client app shows a lock overlay.
     * **Revoke Button**: Instantly terminates the client application, clears local data, and permanently deactivates the token.
     * **Delete Button**: Soft-deletes record and revokes access.

---

## 2. SessionShare Desktop Application

### User Experience Modes

#### Mode 1: Owner Mode
1. **Login View**: Input Owner Master Token.
2. **Dashboard View**:
   * App Status: `Ready to Share`
   * Target Process Selector: Pick running confidential application.
   * Button: `Start Virtual Sharing Session`.
   * Live indicators showing active connections connected to the vault.

#### Mode 2: Normal User Mode
1. **Token Authentication View**:
   * Simple input box: `Enter Session Token`.
   * `Connect` Button.
2. **Session Virtualization Window**:
   * **Custom Framing Window**: The target app renders within an isolated boundary.
   * **Masked Window Controls**: Default close `[X]` buttons on the embedded target application are disabled or hooked. Users can only click "Minimize" or "Exit SessionShare Session".
   * **Overlay Notification**:
     * If the Owner clicks **Pause** on the Web Dashboard, the client UI instantly locks with the message: *"Session Paused by Administrator"*.
     * If the Owner clicks **Revoke**, the app displays *"Session Terminated"*, destroys the local sandboxed profile directory, and returns to the token entry screen.

---

## 3. Design Tokens & Styling
* **Theme**: Dark Mode default (Slate / Zinc tones) to give a sleek enterprise control center feel.
* **Color Palette**:
  * Primary Accent: `#3B82F6` (Blue 500)
  * Active/Success: `#22C55E` (Green 500)
  * Warning/Paused: `#F59E0B` (Amber 500)
  * Destructive/Revoked: `#EF4444` (Red 500)
  * Background: `#090D16` (Deep Charcoal)