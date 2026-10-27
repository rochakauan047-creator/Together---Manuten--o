
const $ = (id) => document.getElementById(id);


const notificationAudio = new Audio('./4-campainha-mp3cut.mp3');
notificationAudio.preload = 'auto';

let soundEnabled = false;
let currentUser = null;
let staffProfile = null;
let unsubscribeOccurrences = null;
let occurrences = [];
let currentFilter = "open";


let audioContext = null;
let knownOccurrenceIds = new Set();
let firstSnapshotLoaded = false;
let toastTimeout = null;

const tabInfo = {
  open: {
    title: "Chamados em espera",
    subtitle: "Ocorrências aguardando um responsável.",
    empty: "Nenhum chamado aguardando atendimento."
  },
  progress: {
    title: "Chamados em andamento",
    subtitle: "Ocorrências aceitas pela equipe de manutenção.",
    empty: "Nenhum chamado em andamento."
  },
  done: {
    title: "Histórico de atendimentos",
    subtitle: "Ocorrências que já foram concluídas.",
    empty: "Nenhuma ocorrência concluída."
  }
};

function showView(viewId) {
  ["authView", "pendingView", "dashboardView"].forEach((id) => {
    $(id).classList.toggle("hidden", id !== viewId);
  });
}

function message(id, text, type = "") {
  $(id).textContent = text;
  $(id).className = `message ${type}`.trim();
}

function errorText(error) {
  const errors = {
    "auth/email-already-in-use": "Este e-mail já possui cadastro. Tente entrar.",
    "auth/invalid-email": "Digite um e-mail válido.",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde e tente novamente.",
    "auth/api-key-not-valid": "A API key do Firebase foi rejeitada. Confira a configuração.",
    "permission-denied": "O Firestore bloqueou a operação. Confira as regras.",
    "firestore/permission-denied": "O Firestore bloqueou a operação. Confira as regras."
  };

  return errors[error.code] || error.message || "Ocorreu um erro.";
}

function showToast(text) {
  const toast = $("toast");
  toast.textContent = text;
  toast.classList.remove("hidden");

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.add("hidden");
  }, 4500);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function dateText(value) {
  if (!value) return "Data não informada";

  const date = typeof value.toDate === "function"
    ? value.toDate()
    : new Date(value);

  return Number.isNaN(date.getTime())
    ? "Data não informada"
    : date.toLocaleString("pt-BR");
}

function statusText(status) {
  return ({
    open: "Em espera",
    progress: "Em andamento",
    done: "Atendido"
  })[status] || "Sem status";
}

function setConnection(text, type = "") {
  const element = $("connectionStatus");
  element.textContent = text;
  element.className = `connection-status ${type}`.trim();
}

function setActiveTab(status) {
  currentFilter = status;

  document.querySelectorAll(".occurrence-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.status === status);
  });

  $("listTitle").textContent = tabInfo[status].title;
  $("listSubtitle").textContent = tabInfo[status].subtitle;

  renderOccurrences();
}

function updateCounters() {
  const counts = {
    open: occurrences.filter((item) => item.data.status === "open").length,
    progress: occurrences.filter((item) => item.data.status === "progress").length,
    done: occurrences.filter((item) => item.data.status === "done").length
  };

  $("countOpen").textContent = counts.open;
  $("countProgress").textContent = counts.progress;
  $("countDone").textContent = counts.done;

  $("tabCountOpen").textContent = counts.open;
  $("tabCountProgress").textContent = counts.progress;
  $("tabCountDone").textContent = counts.done;
}

function renderOccurrences() {
  updateCounters();

  const container = $("occurrencesList");

  const filtered = occurrences.filter(
    (item) => item.data.status === currentFilter
  );

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-state">
        ${escapeHTML(tabInfo[currentFilter].empty)}
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(({ id, data }) => {
    const status = ["open", "progress", "done"].includes(data.status)
      ? data.status
      : "open";

    let action = "";

    if (status === "open") {
      action = `
        <button class="action-button accept-button"
          type="button" data-action="accept" data-id="${escapeHTML(id)}">
          Aceitar chamado
        </button>
      `;
    } else if (status === "progress") {
      action = `
        <button class="action-button complete-button"
          type="button" data-action="complete" data-id="${escapeHTML(id)}">
          Concluir atendimento
        </button>
      `;
    }

    let responsible = "";

    if (status === "progress" && data.assignedTo) {
      responsible = `<p>Responsável: ${escapeHTML(data.assignedTo)}</p>`;
    }

    if (status === "done" && data.completedBy) {
      responsible = `<p>Concluído por: ${escapeHTML(data.completedBy)}</p>`;
    }

    return `
      <article class="occurrence">
        <div class="occurrence-top">
          <div>
            <h3>${escapeHTML(data.category || "Ocorrência")}</h3>
            <p>
              Setor: ${escapeHTML(data.sectorCode || "Não informado")}
              <br>
              Local: ${escapeHTML(data.location || "Não informado")}
            </p>
          </div>
          <span class="status ${status}">${statusText(status)}</span>
        </div>

        <p class="occurrence-description">
          ${escapeHTML(data.description || "Sem descrição")}
        </p>

        <p>Recebida: ${escapeHTML(dateText(data.createdAt))}</p>
        ${responsible}

        ${status === "done" && data.completedAt
          ? `<p>Concluída: ${escapeHTML(dateText(data.completedAt))}</p>`
          : ""}

        <div class="occurrence-footer">
          <p>Protocolo: ${escapeHTML(id.slice(0, 8))}</p>
          <div class="occurrence-actions">${action}</div>
        </div>
      </article>
    `;
  }).join("");

  container.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const newStatus = button.dataset.action === "accept"
        ? "progress"
        : "done";

      await updateOccurrenceStatus(button.dataset.id, newStatus, button);
    });
  });
}

async function updateOccurrenceStatus(id, newStatus, button) {
  if (!currentUser || !staffProfile || staffProfile.active !== true) {
    showToast("Sua sessão não está autorizada.");
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Salvando...";

  const update = {
    status: newStatus,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  if (newStatus === "progress") {
    update.assignedTo = staffProfile.name || currentUser.email;
    update.assignedAt = new Date().toISOString();
  }

  if (newStatus === "done") {
    update.completedBy = staffProfile.name || currentUser.email;
    update.completedAt = new Date().toISOString();
  }

  try {
    await db.collection("occurrences").doc(id).update(update);

    message("dashboardMessage", "");

    showToast(
      newStatus === "progress"
        ? "Chamado aceito! Ele foi movido para Andamento."
        : "Atendimento concluído! Ele foi movido para o Histórico."
    );

    // A atualização em tempo real do Firestore moverá o cartão
    // para a aba correspondente, sem precisar recarregar a página.
  } catch (error) {
    console.error("Erro ao atualizar ocorrência:", error);
    message("dashboardMessage", errorText(error), "error");

    button.disabled = false;
    button.textContent = originalText;
  }
}





function startOccurrenceListener() {
  if (unsubscribeOccurrences) {
    unsubscribeOccurrences();
    unsubscribeOccurrences = null;
  }

  knownOccurrenceIds = new Set();
  firstSnapshotLoaded = false;

  setConnection("Conectando...");

  unsubscribeOccurrences = db.collection("occurrences")
    .orderBy("createdAt", "desc")
    .onSnapshot((snapshot) => {
      const newOpenIds = [];

      snapshot.docChanges().forEach((change) => {
        if (
          change.type === "added" &&
          change.doc.data().status === "open" &&
          firstSnapshotLoaded &&
          !knownOccurrenceIds.has(change.doc.id)
        ) {
          newOpenIds.push(change.doc.id);
        }
      });

      const nextOccurrences = snapshot.docs.map((doc) => ({
        id: doc.id,
        data: doc.data()
      }));

      knownOccurrenceIds = new Set(nextOccurrences.map((item) => item.id));
      occurrences = nextOccurrences;

      renderOccurrences();
      setConnection("Conectado · Tempo real", "connected");

      if (firstSnapshotLoaded && newOpenIds.length > 0) {
        playNotificationSound();

        showToast(
          newOpenIds.length === 1
            ? "Nova ocorrência recebida!"
            : `${newOpenIds.length} novas ocorrências recebidas!`
        );

        if ("Notification" in window && Notification.permission === "granted") {
          try {
            new Notification("Together | Nova ocorrência", {
              body: newOpenIds.length === 1
                ? "Uma nova ocorrência está aguardando atendimento."
                : `${newOpenIds.length} novas ocorrências estão aguardando atendimento.`
            });
          } catch (error) {
            console.warn("Notificação do navegador indisponível:", error);
          }
        }
      }

      firstSnapshotLoaded = true;
    }, (error) => {
      console.error("Erro ao buscar ocorrências:", error);
      setConnection("Erro de conexão", "error");
      message("dashboardMessage", errorText(error), "error");
    });
}


/* ==========================================
   SISTEMA DE SOM E NOTIFICAÇÕES
   ========================================== */



/**
 * Ativa o som após o usuário clicar no botão.
 */
async function enableSound() {
    try {
        notificationAudio.currentTime = 0;
        await notificationAudio.play();

        soundEnabled = true;

        const button = document.getElementById('soundButton');

        if (button) {
            button.textContent = '♫ Som ativado';
            button.classList.add('sound-enabled');
        }
    } catch (error) {
        soundEnabled = false;

        console.error('Erro ao ativar o som:', error);

        alert(
            'Não foi possível tocar o som. ' +
            'Confira se 4-campainha-mp3cut.mp3 está na pasta correta.'
        );
    }
}

/**
 * Reproduz o som quando chega uma nova ocorrência.
 */
function playNotificationSound() {
    if (!soundEnabled) return;

    notificationAudio.currentTime = 0;

    notificationAudio.play().catch(error => {
        console.warn('Erro ao reproduzir o som:', error);
    });
}

/**
 * Solicita permissão para notificações do navegador.
 */
async function requestNotificationPermission() {
    if (!('Notification' in window)) return;

    if (Notification.permission === 'default') {
        try {
            await Notification.requestPermission();
        } catch (error) {
            console.warn('Erro na permissão de notificação:', error);
        }
    }
}

/**
 * Notifica quando uma nova ocorrência é recebida.
 */
function notifyNewOccurrence(item) {
    playNotificationSound();

    if (
        !('Notification' in window) ||
        Notification.permission !== 'granted'
    ) {
        return;
    }

    try {
        new Notification('Nova ocorrência na Arena', {
            body: `${item.category || 'Ocorrência'} — ${
                item.location || 'Local não informado'
            }`,
            tag: `occurrence-${item.id}`
        });
    } catch (error) {
        console.warn('Erro na notificação:', error);
    }
}

/**
 * Conecta o botão de som.
 */
document.addEventListener('DOMContentLoaded', () => {
    const soundButton = document.getElementById('soundButton');

    if (!soundButton) return;

    soundButton.addEventListener('click', async () => {
        await enableSound();
        await requestNotificationPermission();
    });
});

async function openUserPanel(user) {
  const profileDoc = await db.collection("staffUsers").doc(user.uid).get();

  if (!profileDoc.exists) {
    $("pendingEmail").textContent = user.email || "";
    showView("pendingView");
    return;
  }

  staffProfile = profileDoc.data();

  if (staffProfile.active !== true) {
    $("pendingEmail").textContent = user.email || "";
    showView("pendingView");
    return;
  }

  $("welcomeText").textContent =
    `Olá, ${staffProfile.name || user.displayName || user.email}.`;

  showView("dashboardView");
  startOccurrenceListener();
}

$("showLogin").addEventListener("click", () => {
  $("loginForm").classList.remove("hidden");
  $("registerForm").classList.add("hidden");
  $("showLogin").classList.add("active");
  $("showRegister").classList.remove("active");
});

$("showRegister").addEventListener("click", () => {
  $("registerForm").classList.remove("hidden");
  $("loginForm").classList.add("hidden");
  $("showRegister").classList.add("active");
  $("showLogin").classList.remove("active");
});

$("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = $("registerName").value.trim();
  const email = $("registerEmail").value.trim().toLowerCase();
  const password = $("registerPassword").value;
  const button = $("registerForm").querySelector('button[type="submit"]');

  message("registerMessage", "");

  if (!name || name.length > 100) {
    message("registerMessage", "Informe seu nome completo.", "error");
    return;
  }

  button.disabled = true;

  let credential = null;

  try {
    credential = await auth.createUserWithEmailAndPassword(email, password);
    await credential.user.updateProfile({ displayName: name });

await db.collection("staffUsers").doc(credential.user.uid).set({
  name,
  email: credential.user.email,
  active: false,
  createdAt: firebase.firestore.FieldValue.serverTimestamp()
});


    await auth.signOut();

    $("pendingEmail").textContent = email;
    $("registerForm").reset();
    showView("pendingView");
  } catch (error) {
    console.error("Erro no cadastro:", error);

    if (credential) {
      message(
        "registerMessage",
        "A conta foi criada, mas o perfil não foi salvo. Confira as regras do Firestore e o documento staffUsers.",
        "error"
      );
    } else {
      message("registerMessage", errorText(error), "error");
    }
  } finally {
    button.disabled = false;
  }
});

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  const button = $("loginForm").querySelector('button[type="submit"]');

  message("loginMessage", "");
  button.disabled = true;

  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (error) {
    console.error("Erro no login:", error);
    message("loginMessage", errorText(error), "error");
  } finally {
    button.disabled = false;
  }
});

async function logout() {
  if (unsubscribeOccurrences) {
    unsubscribeOccurrences();
    unsubscribeOccurrences = null;
  }

  occurrences = [];
  knownOccurrenceIds.clear();
  firstSnapshotLoaded = false;

  await auth.signOut();
}

$("logoutButton").addEventListener("click", logout);
$("pendingLogout").addEventListener("click", logout);

$("soundButton").addEventListener("click", async () => {
  await enableSound();
  await requestNotificationPermission();
});

document.querySelectorAll(".occurrence-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    setActiveTab(tab.dataset.status);
  });
});

auth.onAuthStateChanged(async (user) => {
  currentUser = user;
  staffProfile = null;
  occurrences = [];

  if (unsubscribeOccurrences) {
    unsubscribeOccurrences();
    unsubscribeOccurrences = null;
  }

  if (!user) {
    showView("authView");
    return;
  }

  try {
    await openUserPanel(user);
  } catch (error) {
    console.error("Erro ao verificar perfil:", error);

    message("loginMessage", errorText(error), "error");

    await auth.signOut();
    showView("authView");
  }
});

setActiveTab("open");
