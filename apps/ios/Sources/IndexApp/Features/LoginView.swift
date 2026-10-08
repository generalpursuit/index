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
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Text("Index").font(.system(size: 54, weight: .semibold, design: .serif)).padding(.top, 70)
        Text(signUp ? "Make room for what matters." : "Good to see you.").font(.title2)
        Text(
          signUp
            ? "Your links, and the people you find them through." : "Sign in to your collection."
        ).foregroundStyle(.secondary)
        if signUp {
          TextField("Name", text: $name).textContentType(.name).ghostInput()
          TextField("Username", text: $username).textContentType(.username)
            .autocorrectionDisabled().ghostInput()
            #if os(iOS)
              .textInputAutocapitalization(.never)
            #endif
          TextField("Email", text: $email).textContentType(.emailAddress).ghostInput()
            #if os(iOS)
              .textInputAutocapitalization(.never).keyboardType(.emailAddress)
            #endif
        } else {
          TextField("Email or username", text: $identifier).textContentType(.username)
            .autocorrectionDisabled().ghostInput()
            #if os(iOS)
              .textInputAutocapitalization(.never)
            #endif
        }
        SecureField("Password", text: $password).textContentType(signUp ? .newPassword : .password)
          .ghostInput()
        AsyncButton {
          if signUp {
            try await app.signUp(
              name: name, username: trimmed(username), email: trimmed(email), password: password)
          } else {
            try await app.signIn(identifier: trimmed(identifier), password: password)
          }
          password = ""
        } label: {
          Text(signUp ? "Create account" : "Sign in").frame(maxWidth: .infinity)
        }
        .buttonStyle(PillStyle(selected: true)).disabled(
          password.count < 8
            || (signUp
              ? !email.contains("@") || trimmed(username).count < 3 || trimmed(name).isEmpty
              : trimmed(identifier).isEmpty))
        Button(signUp ? "Already have an account? Sign in" : "New here? Create an account") {
          signUp.toggle()
        }.font(.subheadline).frame(maxWidth: .infinity)
      }.frame(maxWidth: 420).padding(28).frame(maxWidth: .infinity)
    }.scrollDismissesKeyboard(.interactively)
  }
  private func trimmed(_ text: String) -> String { text.trimmingCharacters(in: .whitespaces) }
}
