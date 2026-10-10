import IndexCore
import SwiftUI

private struct EmailInput: View {
  let title: String
  @Binding var value: String
  var body: some View {
    TextField(title, text: $value).textContentType(.emailAddress).autocorrectionDisabled().ghostInput()
      #if os(iOS)
        .textInputAutocapitalization(.never).keyboardType(.emailAddress)
      #endif
  }
}
private struct CodeInput: View {
  @Binding var value: String
  var body: some View {
    TextField("Six-digit code", text: $value).textContentType(.oneTimeCode).ghostInput()
      #if os(iOS)
        .keyboardType(.numberPad)
      #endif
      .onChange(of: value) { _, next in value = String(next.filter { $0.isASCII && $0.isNumber }.prefix(6)) }
      .accessibilityLabel("Six-digit code")
  }
}
private struct CodeDelivery: View {
  let status: AuthChallengeStatus?
  var body: some View {
    Text(status?.delivery == "failed"
      ? "We couldn’t send the email. Try resending after the cooldown."
      : "Check your inbox and spam folder. Delivery may take a few minutes. Only the latest code works, for 10 minutes.")
      .font(IndexFont.sans(14)).foregroundStyle(IndexPalette.mutedForeground)
  }
}
private struct CooldownAction: View {
  let title: String
  let retryAt: Date
  let action: () async throws -> Void
  var body: some View {
    TimelineView(.periodic(from: .now, by: 1)) { context in
      let seconds = max(0, Int(ceil(retryAt.timeIntervalSince(context.date))))
      AsyncButton(action: action) { Text(seconds > 0 ? "Try again in \(seconds)s" : title) }
        .buttonStyle(PillStyle()).disabled(seconds > 0)
    }
  }
}
struct VerificationView: View {
  let email: String
  @Environment(AppModel.self) private var app
  @State private var status: AuthChallengeStatus?
  @State private var code = ""
  @State private var correcting = false
  @State private var newEmail = ""
  @State private var password = ""
  @State private var retryAt = Date.distantPast
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Text("Verify your email").font(IndexFont.serif(32)).accessibilityAddTraits(.isHeader)
        Text("Enter the six-digit code sent to \(status?.email ?? email).")
        CodeDelivery(status: status)
        CodeInput(value: $code)
        AsyncButton {
          try await app.verifyEmail(code: code)
          code = ""
        } label: { Text("Verify email") }
          .buttonStyle(PillStyle(selected: true)).disabled(code.count != 6)
        CooldownAction(title: "Resend code", retryAt: retryAt) {
          guard let api = app.api else { throw APIError.invalidServer }
          let result = try await api.sendVerification()
          retryAt = Date().addingTimeInterval(Double(result.retryAfter))
          code = ""
          try await refresh()
        }
        Button("Correct email address") { correcting.toggle(); newEmail = status?.email ?? email }
        if correcting {
          Text("Confirm your signup password. The original address stays unchanged until you verify the corrected address.")
            .font(IndexFont.sans(14)).foregroundStyle(IndexPalette.mutedForeground)
          EmailInput(title: "Correct email", value: $newEmail)
          SecureField("Signup password", text: $password).textContentType(.password).ghostInput()
          CooldownAction(title: "Send to corrected address", retryAt: retryAt) {
            guard let api = app.api else { throw APIError.invalidServer }
            let result = try await api.correctEmail(newEmail.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
            retryAt = Date().addingTimeInterval(Double(result.retryAfter))
            password = ""; code = ""; correcting = false
            try await refresh()
          }
        }
        AsyncButton { await app.signOut() } label: { Text("Sign out") }.buttonStyle(PillStyle())
      }.frame(maxWidth: 420).padding(28).frame(maxWidth: .infinity)
    }.foregroundStyle(IndexPalette.foreground).background(IndexPalette.background)
      .scrollDismissesKeyboard(.interactively)
      .task { do { try await refresh() } catch { app.handle(error) } }
      .onDisappear { code = ""; password = "" }
  }
  private func refresh() async throws {
    guard let api = app.api else { throw APIError.invalidServer }
    status = try await api.securityStatus().verification
    retryAt = Date().addingTimeInterval(Double(status?.retryAfter ?? 0))
  }
}
struct PasswordRecoveryView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var email = ""
  @State private var code = ""
  @State private var password = ""
  @State private var confirmation = ""
  @State private var requested = false
  @State private var completed = false
  @State private var retryAt = Date.distantPast
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        PageHeading(title: "Reset your password")
        if completed {
          Text("Password reset. Sign in with your new password. Your other sessions have been signed out.")
        } else {
          EmailInput(title: "Recovery email", value: $email)
          CooldownAction(title: requested ? "Resend recovery code" : "Send recovery code", retryAt: retryAt) {
            guard let api = app.api else { throw APIError.invalidServer }
            let result = try await api.requestPasswordReset(email: email.trimmingCharacters(in: .whitespacesAndNewlines))
            requested = true
            retryAt = Date().addingTimeInterval(Double(result.retryAfter))
          }
          if requested {
            Text("If an account uses this address, a code is on its way. Check spam or retry after the cooldown. Codes expire in 10 minutes.")
              .font(IndexFont.sans(14)).foregroundStyle(IndexPalette.mutedForeground)
            CodeInput(value: $code)
            SecureField("New password", text: $password).textContentType(.newPassword).ghostInput()
            SecureField("Confirm new password", text: $confirmation).textContentType(.newPassword).ghostInput()
            AsyncButton {
              guard let api = app.api else { throw APIError.invalidServer }
              guard password == confirmation else { throw APIError.server(400, "Passwords do not match.") }
              try await api.resetPassword(email: email.trimmingCharacters(in: .whitespacesAndNewlines), code: code, newPassword: password)
              app.clearAccount()
              password = ""; confirmation = ""; code = ""; completed = true
            } label: { Text("Reset password") }
              .buttonStyle(PillStyle(selected: true)).disabled(code.count != 6 || password.count < 8 || password.count > 128)
          }
        }
        Button("Back to sign in") { dismiss() }.buttonStyle(PillStyle())
      }.frame(maxWidth: 420).padding(28).frame(maxWidth: .infinity)
    }.foregroundStyle(IndexPalette.foreground).background(IndexPalette.background)
      .scrollDismissesKeyboard(.interactively)
      .onDisappear { password = ""; confirmation = ""; code = "" }
  }
}
struct AccountSecurityView: View {
  @Environment(AppModel.self) private var app
  @State private var changingEmail = false
  @State private var password = ""
  @State private var newPassword = ""
  @State private var confirmation = ""
  @State private var email = ""
  @State private var code = ""
  @State private var pending: AuthChallengeStatus?
  @State private var retryAt = Date.distantPast
  @State private var message = ""
  var body: some View {
    DisclosureGroup("Account security") {
      VStack(alignment: .leading, spacing: 16) {
        Picker("Change", selection: $changingEmail) {
          Text("Password").tag(false)
          Text("Email").tag(true)
        }.pickerStyle(.segmented)
        SecureField("Current password", text: $password).textContentType(.password).ghostInput()
        if changingEmail {
          Text("Your current email stays active until you verify the new address.").font(IndexFont.sans(14)).foregroundStyle(IndexPalette.mutedForeground)
          EmailInput(title: "New email", value: $email)
          CooldownAction(title: "Send email change code", retryAt: retryAt) {
            guard let api = app.api else { throw APIError.invalidServer }
            let result = try await api.requestEmailChange(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
            retryAt = Date().addingTimeInterval(Double(result.retryAfter))
            password = ""; code = ""
            try await refresh()
          }
        } else {
          SecureField("New password", text: $newPassword).textContentType(.newPassword).ghostInput()
          SecureField("Confirm new password", text: $confirmation).textContentType(.newPassword).ghostInput()
          AsyncButton {
            guard let api = app.api else { throw APIError.invalidServer }
            guard newPassword == confirmation else { throw APIError.server(400, "Passwords do not match.") }
            try await api.changePassword(currentPassword: password, newPassword: newPassword)
            password = ""; newPassword = ""; confirmation = ""
            message = "Password changed. Other sessions have been signed out."
            try await refresh()
          } label: { Text("Save password") }
            .buttonStyle(PillStyle(selected: true)).disabled(password.isEmpty || newPassword.count < 8 || newPassword.count > 128)
        }
        if let pending, pending.pending {
          Text("Verify \(pending.email)")
          CodeDelivery(status: pending)
          CodeInput(value: $code)
          AsyncButton {
            guard let api = app.api else { throw APIError.invalidServer }
            try await api.confirmEmailChange(code: code)
            code = ""; message = "Email changed. Other sessions have been signed out."
            try await refresh()
          } label: { Text("Confirm new email") }.buttonStyle(PillStyle(selected: true)).disabled(code.count != 6)
        }
        if !message.isEmpty { Text(message).foregroundStyle(IndexPalette.mutedForeground).accessibilityAddTraits(.updatesFrequently) }
      }.padding(.top)
    }.task { do { try await refresh() } catch { app.handle(error) } }
      .onDisappear { password = ""; newPassword = ""; confirmation = ""; code = "" }
  }
  private func refresh() async throws {
    guard let api = app.api else { throw APIError.invalidServer }
    pending = try await api.securityStatus().emailChange
    retryAt = Date().addingTimeInterval(Double(pending?.retryAfter ?? 0))
  }
}
