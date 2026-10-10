import IndexCore
import SwiftUI

struct LoginView: View {
  @Environment(AppModel.self) private var app
  @State private var identifier = ""
  @State private var email = ""
  @State private var username = ""
  @State private var password = ""
  @State private var name = ""
  @State private var signUp = false
  @State private var recovering = false
  var body: some View {
    GeometryReader { geometry in
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          IndexWordmark().frame(height: 34).frame(maxWidth: .infinity).padding(.bottom, 30)
          if signUp {
            authField("Name") { TextField("", text: $name).textContentType(.name).ghostInput(background: IndexPalette.surface) }
            authField("Username") {
              TextField("", text: $username).textContentType(.username).autocorrectionDisabled()
                .ghostInput(background: IndexPalette.surface)
                #if os(iOS)
                  .textInputAutocapitalization(.never)
                #endif
            }
            authField("Email") {
              TextField("", text: $email).textContentType(.emailAddress).ghostInput(background: IndexPalette.surface)
                #if os(iOS)
                  .textInputAutocapitalization(.never).keyboardType(.emailAddress)
                #endif
            }
          } else {
            authField("Email or username") {
              TextField("", text: $identifier).textContentType(.username).autocorrectionDisabled()
                .ghostInput(background: IndexPalette.surface)
                #if os(iOS)
                  .textInputAutocapitalization(.never)
                #endif
            }
          }
          authField("Password") {
            SecureField("", text: $password).textContentType(signUp ? .newPassword : .password)
              .ghostInput(background: IndexPalette.surface)
          }
          AsyncButton {
            if signUp {
              try await app.signUp(name: name, username: trimmed(username), email: trimmed(email), password: password)
            } else { try await app.signIn(identifier: trimmed(identifier), password: password) }
            password = ""
          } label: { Text(signUp ? "Create account" : "Sign in").frame(maxWidth: .infinity) }
            .buttonStyle(PillStyle(selected: true)).padding(.top, 6)
            .disabled(password.count < 8 || (signUp
              ? !email.contains("@") || trimmed(username).count < 3 || trimmed(name).isEmpty
              : trimmed(identifier).isEmpty))
          if !signUp {
            Button("Forgot password?") { recovering = true }.buttonStyle(.plain).frame(minHeight: 44)
          }
          HStack(spacing: 0) {
            Text(signUp ? "Already have an account? " : "New here? ").foregroundStyle(IndexPalette.subtleForeground)
            Button(signUp ? "Sign in" : "Create an account") { signUp.toggle() }.buttonStyle(.plain)
          }.font(IndexFont.sans(14)).frame(maxWidth: .infinity).padding(.top, 6)
        }.frame(maxWidth: 360).padding(.horizontal, 24).padding(.vertical, 40)
          .frame(maxWidth: .infinity).frame(minHeight: geometry.size.height)
      }.scrollDismissesKeyboard(.interactively)
    }.background(IndexPalette.background)
      .sheet(isPresented: $recovering) {
        PasswordRecoveryView().indexSheetStyle().presentationDetents([.large])
      }
      .onDisappear { password = "" }
  }
  private func authField<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title).font(IndexFont.sans(14, weight: .medium))
      content().accessibilityLabel(title)
    }
  }
  private func trimmed(_ text: String) -> String { text.trimmingCharacters(in: .whitespaces) }
}
