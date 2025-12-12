import React, { useState } from "react";
import PropTypes from "prop-types";
import { requestAccess, resendPassword } from "../services/api.js";
import { setViewerSession, getClientViewerId } from "../services/auth.js";

function AccessGate({ event, eventId, accessMode, onAccessGranted }) {
  const [modeView, setModeView] = useState("register");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
  });
  const [registrationConflict, setRegistrationConflict] = useState(false);
  const [isPayComplete, setIsPayComplete] = useState(false);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rawResponse, setRawResponse] = useState(null);

  const clientViewerId = getClientViewerId();

  const updateField = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  async function handlePasswordRegister(e) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const body = {
      mode: "register",
      clientViewerId,
      formData: {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
      },
      deviceType: "desktop",
    };
    const res = await requestAccess(eventId, body);
    setRawResponse(res);
    setLoading(false);
    if (res.status === 409) {
      setRegistrationConflict(true);
      setMessage(res.data?.message || "Email already registered. Please login.");
      return;
    }
    setRegistrationConflict(false);
    if (!res.ok) {
      setMessage(res.data?.message || "Registration failed");
      return;
    }
    setMessage(res.data?.message || "Registration successful. Check your email for the password.");
    setModeView("login");
  }

  async function handleResendPassword() {
    if (!form.email) {
      setMessage("Provide the email address to resend the password.");
      return;
    }
    setLoading(true);
    setMessage(null);
    const res = await resendPassword(eventId, {
      email: form.email,
      clientViewerId,
      firstName: form.firstName,
      lastName: form.lastName,
    });
    setRawResponse(res);
    setLoading(false);
    if (!res.ok) {
      setMessage(res.data?.message || "Unable to resend password.");
      return;
    }
    setMessage(res.data?.message || "Password email resent successfully.");
  }

  async function handlePasswordLogin(e) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const body = {
      mode: "login",
      clientViewerId,
      email: form.email,
      password: form.password,
    };
    const res = await requestAccess(eventId, body);
    setRawResponse(res);
    setLoading(false);
    if (!res.ok || !res.data?.accessGranted || !res.data?.token) {
      setMessage(res.data?.message || "Login failed");
      return;
    }
    setViewerSession({ token: res.data.token, viewerId: res.data.viewerId });
    setMessage("Login successful");
    onAccessGranted?.();
  }

  async function handlePaidAccess(e) {
    e.preventDefault();
    if (!isPayComplete) {
      setMessage("Simulate payment first using the Pay/Test button.");
      return;
    }
    setLoading(true);
    setMessage(null);
    const body = {
      clientViewerId,
      email: form.email,
      isPaidViewer: true,
    };
    const res = await requestAccess(eventId, body);
    setRawResponse(res);
    setLoading(false);
    if (!res.ok || !res.data?.accessGranted || !res.data?.token) {
      setMessage(res.data?.message || "Paid access still blocked");
      return;
    }
    setViewerSession({ token: res.data.token, viewerId: res.data.viewerId });
    setMessage("Paid access granted");
    onAccessGranted?.();
  }

  async function handlePublicContinue() {
    setLoading(true);
    setMessage(null);
    const res = await requestAccess(eventId, { clientViewerId });
    setRawResponse(res);
    setLoading(false);

    if (!res.ok || !res.data?.accessGranted || !res.data?.token) {
      setMessage(res.data?.message || "Unable to acquire viewer token for playback.");
      return;
    }

    setViewerSession({ token: res.data.token, viewerId: res.data.viewerId });
    setMessage("Access granted. Loading player...");
    onAccessGranted?.();
  }

  async function handlePrivateToken(e) {
    e.preventDefault();
    // Allow manual token input for private flows
    if (!form.password) {
      setMessage("Paste a viewer token into the password field to use it.");
      return;
    }
    setViewerSession({ token: form.password, viewerId: null });
    setMessage("Token stored. Attempting playback…");
    onAccessGranted?.();
  }

  const commonInfo = (
    <p>
      <small>
        accessMode: <code>{event.accessMode || "publicAccess"}</code> ({accessMode}) · clientViewerId: <code>{clientViewerId}</code>
      </small>
    </p>
  );

  return (
    <div className="card">
      <h2>Access Required</h2>
      {commonInfo}

      {accessMode === "public" && (
        <div>
          <p>This event is public. Continue to playback.</p>
          <button onClick={handlePublicContinue}>Continue</button>
        </div>
      )}

      {accessMode === "private" && (
        <form onSubmit={handlePrivateToken}>
          <p>This event is private. Use an invite or paste a token.</p>
          <label htmlFor="private-viewer-token">Viewer token (paste here)</label>
          <input
            id="private-viewer-token"
            type="text"
            placeholder="paste JWT token"
            value={form.password}
            onChange={updateField("password")}
          />
          <div style={{ marginTop: 8 }}>
            <button type="submit" disabled={loading}>
              Use token
            </button>
          </div>
        </form>
      )}

      {accessMode === "password" && (
        <div>
          {modeView === "register" ? (
            <div>
              <h3>Password Registration</h3>
              <form onSubmit={handlePasswordRegister}>
                <label htmlFor="register-first-name">First name</label>
                <input
                  id="register-first-name"
                  value={form.firstName}
                  onChange={updateField("firstName")}
                />
                <label htmlFor="register-last-name">Last name</label>
                <input
                  id="register-last-name"
                  value={form.lastName}
                  onChange={updateField("lastName")}
                />
                <label htmlFor="register-email">Email</label>
                <input
                  id="register-email"
                  type="email"
                  value={form.email}
                  onChange={updateField("email")}
                />
                <div style={{ marginTop: 8 }}>
                  <button type="submit" disabled={loading}>
                    Register &amp; send password
                  </button>
                </div>
              </form>
              {registrationConflict && (
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="link-button"
                    onClick={handleResendPassword}
                    disabled={loading}
                  >
                    Resend password?
                  </button>
                </div>
              )}
              <div style={{ marginTop: 8 }}>
                  <button type="button" className="link-button" onClick={() => { setModeView("login"); setRegistrationConflict(false); }}>
                    Already registered? Click here to login
                  </button>
                </div>
            </div>
          ) : (
            <div>
              <h3>Password Login</h3>
              <form onSubmit={handlePasswordLogin}>
                <label htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  type="email"
                  value={form.email}
                  onChange={updateField("email")}
                />
                <label htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  type="text"
                  value={form.password}
                  onChange={updateField("password")}
                />
                <div style={{ marginTop: 8 }}>
                  <button type="submit" disabled={loading}>
                    Login
                  </button>
                </div>
              </form>
              <div style={{ marginTop: 8 }}>
                <button type="button" className="link-button" onClick={() => { setModeView("register"); setRegistrationConflict(false); }}>
                  Need to register? Click here
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {accessMode === "payment" && (
        <div>
          <p>
            This event requires payment. Use the test button below to simulate a completed payment, then request
            access.
          </p>
          <div style={{ marginBottom: 8 }}>
            <button
              type="button"
              className="secondary"
              onClick={() => setIsPayComplete(true)}
              disabled={isPayComplete}
            >
              {isPayComplete ? "Payment simulated" : "Simulate payment"}
            </button>
          </div>
          <form onSubmit={handlePaidAccess}>
            <label htmlFor="payment-email">Email</label>
            <input
              id="payment-email"
              type="email"
              value={form.email}
              onChange={updateField("email")}
            />
            <div style={{ marginTop: 8 }}>
              <button type="submit" disabled={loading}>
                Request paid access
              </button>
            </div>
          </form>
        </div>
      )}

      {message && (
        <p style={{ marginTop: 8 }}>
          <small>{message}</small>
        </p>
      )}

      {import.meta.env.DEV && rawResponse && (
        <div style={{ marginTop: 8 }}>
          <details>
            <summary>Raw server response</summary>
            <pre className="debug">{JSON.stringify(rawResponse, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}

AccessGate.propTypes = {
  event: PropTypes.shape({
    accessMode: PropTypes.string,
  }),
  eventId: PropTypes.string.isRequired,
  accessMode: PropTypes.string.isRequired,
  onAccessGranted: PropTypes.func,
};

export default AccessGate;
